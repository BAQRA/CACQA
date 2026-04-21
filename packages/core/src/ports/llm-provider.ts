import { type LLMError } from '../errors.js';
import { type ResultAsync } from '../result.js';
import { type Failure } from '../domain/failure.js';
import { type GameState } from '../domain/game-state.js';
import { type Scenario, type ScenarioCategory } from '../domain/scenario.js';

export interface StateExtractionInput {
  readonly screenshot: Buffer;
  readonly ocrHint: string;
  readonly priorState: GameState | null;
}

export interface ScenarioGenerationInput {
  readonly state: GameState;
  readonly recentScenarios: readonly string[];
  readonly desiredCategory: ScenarioCategory | null;
  readonly recentFailures: readonly Failure[];
}

export interface FailureAnalysisInput {
  readonly failure: Failure;
  readonly stateBefore: GameState | null;
  readonly stateAfter: GameState | null;
}

export interface FailureAnalysis {
  readonly hypothesis: string;
  readonly reproductionSteps: readonly string[];
  readonly likelyCategory: 'display-bug' | 'logic-bug' | 'race-condition' | 'network' | 'unknown';
  readonly confidence: number;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * Port: calls an LLM to understand what's on screen, suggest next test
 * scenarios, and triage failures. Implementations MUST:
 *   - validate their output against the domain schemas (Zod) before returning
 *   - surface token usage so we can meter customers later
 *   - be deterministic given the same input + seed (for reproducibility)
 */
export interface LLMProvider {
  readonly name: string;

  extractState(
    input: StateExtractionInput,
  ): ResultAsync<{ state: GameState; usage: TokenUsage }, LLMError>;

  generateScenario(
    input: ScenarioGenerationInput,
  ): ResultAsync<{ scenario: Scenario; usage: TokenUsage }, LLMError>;

  analyzeFailure(
    input: FailureAnalysisInput,
  ): ResultAsync<{ analysis: FailureAnalysis; usage: TokenUsage }, LLMError>;
}
