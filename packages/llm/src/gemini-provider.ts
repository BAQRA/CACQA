import {
  GoogleGenerativeAI,
  type GenerateContentResult,
  type GenerativeModel,
  type GenerationConfig,
} from '@google/generative-ai';
import {
  errAsync,
  LLMError,
  ResultAsync,
  type FailureAnalysis,
  type FailureAnalysisInput,
  type GameState,
  type LLMProvider,
  type Logger,
  type Scenario,
  type ScenarioGenerationInput,
  type StateExtractionInput,
  type TokenUsage,
} from '@cacqa/core';
import type { z, ZodTypeAny } from 'zod';

import {
  AnalyzeFailureResponseSchema,
  ExtractStateResponseSchema,
  GenerateScenarioResponseSchema,
  type ExtractStateResponse,
  type GenerateScenarioResponse,
} from './schemas.js';
import {
  buildStateExtractionPrompt,
  SYSTEM_PROMPT_FAILURE_ANALYSIS,
  SYSTEM_PROMPT_SCENARIO_GENERATION,
} from './prompts.js';

export interface GeminiProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly logger: Logger;
  /** Deterministic output — set to 0 in tests/reproductions, 0.4ish for exploration. */
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
}

/**
 * Gemini adapter. Responsibilities:
 *   - wire the SDK once (model reused across calls)
 *   - assemble prompts using the templates in ./prompts.ts
 *   - force JSON output via responseMimeType
 *   - parse & validate through Zod, wrap all errors as LLMError
 *
 * This file is the ONLY place @google/generative-ai is imported. Swapping to
 * Claude or OpenAI is a new file, same interface.
 */
export class GeminiProvider implements LLMProvider {
  public readonly name = 'gemini';

  private readonly model: GenerativeModel;
  private readonly generationConfig: GenerationConfig;
  private readonly log: Logger;

  public constructor(opts: GeminiProviderOptions) {
    const client = new GoogleGenerativeAI(opts.apiKey);
    this.model = client.getGenerativeModel({ model: opts.model });
    this.generationConfig = {
      temperature: opts.temperature ?? 0.2,
      // 4096 comfortably fits a busy game UI (balance, round, ~15 elements,
      // dismissHint). Games with many decorative elements were hitting 2048.
      maxOutputTokens: opts.maxOutputTokens ?? 4096,
      responseMimeType: 'application/json',
    };
    this.log = opts.logger.child({ provider: 'gemini', model: opts.model });
  }

  public extractState(
    input: StateExtractionInput,
  ): ResultAsync<{ state: GameState; usage: TokenUsage }, LLMError> {
    const prompt = buildStateExtractionPrompt(input.ocrHint);
    return this.callJson(prompt, input.screenshot, ExtractStateResponseSchema).map((result) => ({
      state: this.toGameState(result.parsed, input),
      usage: result.usage,
    }));
  }

  public generateScenario(
    input: ScenarioGenerationInput,
  ): ResultAsync<{ scenario: Scenario; usage: TokenUsage }, LLMError> {
    const prompt = [
      SYSTEM_PROMPT_SCENARIO_GENERATION,
      '',
      `Current state (JSON): ${JSON.stringify(
        {
          balance: input.state.balance,
          round: input.state.round,
          elements: input.state.elements.map((e) => ({ label: e.label, kind: e.kind })),
        },
        null,
        2,
      )}`,
      '',
      `Recent scenario names (avoid verbatim repeats): ${JSON.stringify(input.recentScenarios)}`,
      input.desiredCategory ? `Requested category: ${input.desiredCategory}` : '',
      input.recentFailures.length > 0
        ? `Recent failure rule ids: ${input.recentFailures.map((f) => f.ruleId).join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    return this.callJson(prompt, null, GenerateScenarioResponseSchema).map((result) => ({
      scenario: this.toScenario(result.parsed),
      usage: result.usage,
    }));
  }

  public analyzeFailure(
    input: FailureAnalysisInput,
  ): ResultAsync<{ analysis: FailureAnalysis; usage: TokenUsage }, LLMError> {
    const prompt = [
      SYSTEM_PROMPT_FAILURE_ANALYSIS,
      '',
      `Failure: ${JSON.stringify(input.failure, null, 2)}`,
      `State before: ${JSON.stringify(input.stateBefore ?? null)}`,
      `State after: ${JSON.stringify(input.stateAfter ?? null)}`,
    ].join('\n');

    return this.callJson(prompt, null, AnalyzeFailureResponseSchema).map((result) => ({
      analysis: result.parsed,
      usage: result.usage,
    }));
  }

  // ── private ────────────────────────────────────────────────────────────────

  /**
   * Wraps generateContent with retries for transient errors (5xx, 503
   * "overloaded"). 429 quota errors are NOT retried — they're authoritative,
   * and retrying burns more quota. Exponential backoff: 2s, 5s.
   */
  private async generateWithRetry(
    parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }>,
    prompt: string,
  ): Promise<GenerateContentResult> {
    const delays = [2_000, 5_000];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await this.model.generateContent({
          contents: [{ role: 'user', parts }],
          generationConfig: this.generationConfig,
        });
      } catch (err) {
        lastErr = err;
        const retryable = this.isRetryable(err);
        if (!retryable || attempt === delays.length) {
          throw err;
        }
        const delay = delays[attempt] ?? 2_000;
        this.log.warn(
          { attempt: attempt + 1, delayMs: delay, promptPreview: prompt.slice(0, 100) },
          'Gemini transient error; retrying',
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr;
  }

  private isRetryable(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    // 503 Service Unavailable / "overloaded" / 500 Internal Server Error.
    // 429 is NOT retryable — it's quota, and retrying wastes more quota.
    return /\b(503|500|502|504)\b/.test(msg) || /overloaded|unavailable/i.test(msg);
  }

  private callJson<S extends ZodTypeAny>(
    prompt: string,
    screenshot: Buffer | null,
    schema: S,
  ): ResultAsync<{ parsed: z.infer<S>; usage: TokenUsage }, LLMError> {
    const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
      { text: prompt },
    ];
    if (screenshot) {
      parts.push({ inlineData: { data: screenshot.toString('base64'), mimeType: 'image/png' } });
    }

    return ResultAsync.fromPromise(
      this.generateWithRetry(parts, prompt),
      (cause) =>
        new LLMError('Gemini API call failed', {
          cause,
          context: { promptPreview: prompt.slice(0, 200) },
        }),
    ).andThen<{ parsed: z.infer<S>; usage: TokenUsage }, LLMError>((response: GenerateContentResult) => {
      const text = response.response.text();
      const usage: TokenUsage = {
        inputTokens: response.response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.response.usageMetadata?.candidatesTokenCount ?? 0,
      };

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (cause) {
        this.log.warn({ text: text.slice(0, 500) }, 'Gemini returned non-JSON output');
        return errAsync(
          new LLMError('Gemini returned non-JSON output', { cause, context: { preview: text.slice(0, 200) } }),
        );
      }

      const validated = schema.safeParse(json);
      if (!validated.success) {
        return errAsync(
          new LLMError('Gemini response failed schema validation', {
            context: { raw: json, issues: validated.error.issues },
          }),
        );
      }
      return ResultAsync.fromSafePromise(Promise.resolve({ parsed: validated.data, usage }));
    });
  }

  private toGameState(resp: ExtractStateResponse, input: StateExtractionInput): GameState {
    return {
      capturedAt: new Date(),
      balance: resp.balance,
      round: resp.round,
      elements: resp.elements,
      ocrText: input.ocrHint,
      screenshotRef: 'pending', // filled in by the caller after persisting
      dismissHint: resp.dismissHint,
    };
  }

  private toScenario(resp: GenerateScenarioResponse): Scenario {
    return { ...resp, origin: 'llm-generated' };
  }
}
