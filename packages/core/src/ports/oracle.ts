import { type OracleError } from '../errors.js';
import { type Result } from '../result.js';
import { type Action } from '../domain/action.js';
import { type GameState } from '../domain/game-state.js';
import { type Scenario } from '../domain/scenario.js';

export interface RuleContext {
  readonly scenario: Scenario;
  readonly stateBefore: GameState;
  readonly stateAfter: GameState;
  readonly action: Action | null;
}

export interface RuleViolation {
  readonly ruleId: string;
  readonly severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  readonly message: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * A Rule is a pure function: (context) -> violations. Rules MUST NOT perform
 * I/O and MUST be deterministic — that's what lets us replay a session and
 * confirm a bug is still present.
 */
export interface Rule {
  readonly id: string;
  readonly description: string;
  evaluate(ctx: RuleContext): readonly RuleViolation[];
}

export interface Oracle {
  readonly rules: readonly Rule[];
  evaluate(ctx: RuleContext): Result<readonly RuleViolation[], OracleError>;
}
