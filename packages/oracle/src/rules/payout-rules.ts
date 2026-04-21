import { mulMoney, type Rule, type RuleContext, type RuleViolation } from '@cacqa/core';

const PAYOUT_TOLERANCE_UNITS = 1; // 1 cent — accommodates rounding in the game UI

/**
 * If the current round shows a multiplier and a bet, and the round has been
 * cashed out, the payout must equal bet * multiplier within tolerance.
 */
export const payoutMatchesMultiplier: Rule = {
  id: 'payout-matches-multiplier',
  description: 'Payout must equal bet × multiplier within rounding tolerance.',
  evaluate({ stateAfter }): readonly RuleViolation[] {
    const round = stateAfter.round;
    if (!round || round.outcome !== 'cashed-out') {
      return [];
    }
    if (!round.betAmount || !round.payout || typeof round.multiplier !== 'number') {
      return [];
    }
    const expected = mulMoney(round.betAmount, round.multiplier);
    const delta = Math.abs(round.payout.amount - expected.amount);
    if (delta > PAYOUT_TOLERANCE_UNITS) {
      return [
        {
          ruleId: 'payout-matches-multiplier',
          severity: 'critical',
          message: `Payout ${round.payout.amount} differs from expected ${expected.amount} by ${delta}.`,
          metadata: {
            bet: round.betAmount,
            multiplier: round.multiplier,
            payout: round.payout,
            expected,
            delta,
          },
        },
      ];
    }
    return [];
  },
};
