import {
  okAsync,
  ResultAsync,
  type FailureAnalysis,
  type FailureAnalysisInput,
  type GameState,
  type LLMError,
  type LLMProvider,
  type Scenario,
  type ScenarioGenerationInput,
  type StateExtractionInput,
  type TokenUsage,
} from '@cacqa/core';

/**
 * Offline provider for tests and CI. Returns fixed, deterministic output so the
 * worker's logic can be exercised without network access or API keys.
 *
 * NOT for production use — a real provider MUST be configured.
 */
export class MockLLMProvider implements LLMProvider {
  public readonly name = 'mock';

  private static readonly USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  public extractState(
    input: StateExtractionInput,
  ): ResultAsync<{ state: GameState; usage: TokenUsage }, LLMError> {
    const state: GameState = {
      capturedAt: new Date(),
      balance: { amount: 100_00, currency: 'USD' },
      round: { outcome: 'pending' },
      elements: [
        {
          label: 'place bet',
          kind: 'button',
          bounds: { x: 100, y: 500, width: 120, height: 40 },
          enabled: true,
          confidence: 1,
        },
      ],
      ocrText: input.ocrHint,
      screenshotRef: 'pending',
      dismissHint: null,
    };
    return okAsync({ state, usage: MockLLMProvider.USAGE });
  }

  public generateScenario(
    _input: ScenarioGenerationInput,
  ): ResultAsync<{ scenario: Scenario; usage: TokenUsage }, LLMError> {
    const scenario: Scenario = {
      id: 'mock-smoke',
      name: 'Mock smoke — place a minimum bet',
      category: 'smoke',
      description: 'Deterministic scenario returned by MockLLMProvider.',
      actions: [{ type: 'place-bet' }, { type: 'wait', milliseconds: 500 }],
      expectation: {
        description: 'Balance decreases by the bet amount immediately.',
        ruleIds: ['balance-decreases-on-bet'],
      },
      origin: 'llm-generated',
    };
    return okAsync({ scenario, usage: MockLLMProvider.USAGE });
  }

  public analyzeFailure(
    input: FailureAnalysisInput,
  ): ResultAsync<{ analysis: FailureAnalysis; usage: TokenUsage }, LLMError> {
    return okAsync({
      analysis: {
        hypothesis: `Mock hypothesis for rule ${input.failure.ruleId}`,
        reproductionSteps: ['Run the same scenario again', 'Observe the state change'],
        likelyCategory: 'unknown',
        confidence: 0.1,
      },
      usage: MockLLMProvider.USAGE,
    });
  }
}
