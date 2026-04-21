import { type Rule, type RuleContext, type RuleViolation } from '@cacqa/core';

/**
 * After a place-bet action the cash-out button SHOULD become available within
 * one observation cycle. If it stays disabled or absent, the user is locked
 * out of their funds — high severity.
 */
export const cashOutAvailableMidRound: Rule = {
  id: 'cash-out-available-mid-round',
  description: 'Cash-out control must be present and enabled while a round is pending.',
  evaluate({ stateAfter, action }): readonly RuleViolation[] {
    if (action?.type !== 'place-bet') {
      return [];
    }
    if (stateAfter.round?.outcome !== 'pending') {
      return [];
    }
    const cashOut = stateAfter.elements.find((e) => e.label.toLowerCase().includes('cash out'));
    if (!cashOut) {
      return [
        {
          ruleId: 'cash-out-available-mid-round',
          severity: 'high',
          message: 'Cash-out control not found after placing bet.',
        },
      ];
    }
    // Absent `enabled` means the vision layer didn't report it — treat as
    // enabled (avoid false positives when the LLM omits the field).
    if (cashOut.enabled === false) {
      return [
        {
          ruleId: 'cash-out-available-mid-round',
          severity: 'high',
          message: 'Cash-out control present but disabled while round is pending.',
        },
      ];
    }
    return [];
  },
};
