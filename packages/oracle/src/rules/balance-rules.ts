import { subMoney, type Rule, type RuleContext, type RuleViolation } from '@cacqa/core';

/**
 * Balance must never change without an explicit action that moves money
 * (place-bet, cash-out). A silent balance shift is a critical bug — either a
 * display glitch or, worse, a wallet desync.
 */
export const balanceStableWithoutMoneyAction: Rule = {
  id: 'balance-stable-without-money-action',
  description: 'Balance must not change without a bet/cash-out action.',
  evaluate({ stateBefore, stateAfter, action }): readonly RuleViolation[] {
    if (!stateBefore.balance || !stateAfter.balance) {
      return [];
    }
    if (stateBefore.balance.currency !== stateAfter.balance.currency) {
      return [
        {
          ruleId: 'balance-stable-without-money-action',
          severity: 'critical',
          message: `Currency changed mid-session: ${stateBefore.balance.currency} -> ${stateAfter.balance.currency}`,
          metadata: { before: stateBefore.balance, after: stateAfter.balance },
        },
      ];
    }

    const delta = subMoney(stateAfter.balance, stateBefore.balance).amount;
    const isMoneyAction = action?.type === 'place-bet' || action?.type === 'cash-out';
    if (delta !== 0 && !isMoneyAction) {
      return [
        {
          ruleId: 'balance-stable-without-money-action',
          severity: 'high',
          message: `Balance changed by ${delta} without a money action (${action?.type ?? 'none'}).`,
          metadata: { delta, action: action?.type ?? null },
        },
      ];
    }
    return [];
  },
};

/**
 * After place-bet the balance MUST decrease (or remain equal on a bet-rejected
 * path). An increase would mean we got paid before betting.
 */
export const balanceDecreasesOnBet: Rule = {
  id: 'balance-decreases-on-bet',
  description: 'Balance must not increase after a place-bet action.',
  evaluate({ stateBefore, stateAfter, action }): readonly RuleViolation[] {
    if (action?.type !== 'place-bet') {
      return [];
    }
    if (!stateBefore.balance || !stateAfter.balance) {
      return [];
    }
    const delta = subMoney(stateAfter.balance, stateBefore.balance).amount;
    if (delta > 0) {
      return [
        {
          ruleId: 'balance-decreases-on-bet',
          severity: 'critical',
          message: `Balance increased by ${delta} after placing a bet.`,
          metadata: { delta },
        },
      ];
    }
    return [];
  },
};
