import {
  err,
  ok,
  OracleError,
  type Oracle,
  type Result,
  type Rule,
  type RuleContext,
  type RuleViolation,
} from '@cacqa/core';

import { balanceDecreasesOnBet, balanceStableWithoutMoneyAction } from './rules/balance-rules.js';
import { payoutMatchesMultiplier } from './rules/payout-rules.js';
import { cashOutAvailableMidRound } from './rules/ui-rules.js';

/**
 * Default Oracle: runs each rule independently, collects all violations.
 * Failure of one rule does not short-circuit others — we want maximum signal
 * per session.
 */
export class RuleEngine implements Oracle {
  public constructor(public readonly rules: readonly Rule[]) {}

  public evaluate(ctx: RuleContext): Result<readonly RuleViolation[], OracleError> {
    const violations: RuleViolation[] = [];
    const ruleErrors: Array<{ ruleId: string; cause: unknown }> = [];

    for (const rule of this.rules) {
      try {
        const result = rule.evaluate(ctx);
        violations.push(...result);
      } catch (cause) {
        ruleErrors.push({ ruleId: rule.id, cause });
      }
    }

    if (ruleErrors.length > 0) {
      return err(
        new OracleError('One or more rules threw during evaluation', {
          cause: ruleErrors[0]?.cause,
          context: { failedRules: ruleErrors.map((r) => r.ruleId) },
        }),
      );
    }
    return ok(violations);
  }
}

export const DEFAULT_RULES: readonly Rule[] = [
  balanceStableWithoutMoneyAction,
  balanceDecreasesOnBet,
  payoutMatchesMultiplier,
  cashOutAvailableMidRound,
];

export function createDefaultOracle(extraRules: readonly Rule[] = []): Oracle {
  return new RuleEngine([...DEFAULT_RULES, ...extraRules]);
}
