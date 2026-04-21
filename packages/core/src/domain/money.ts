import { z } from 'zod';

/**
 * Money is represented as an integer in the smallest currency unit (cents,
 * satoshis, etc.) to avoid float rounding in payout comparisons. Games may
 * display "1.50" — the adapter is responsible for parsing that into 150.
 */
export const MoneySchema = z.object({
  amount: z.number().int(),
  currency: z.string().min(1).max(8),
});
export type Money = z.infer<typeof MoneySchema>;

export const ZERO = (currency: string): Money => ({ amount: 0, currency });

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function subMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount - b.amount, currency: a.currency };
}

export function mulMoney(a: Money, multiplier: number): Money {
  // Round-half-away-from-zero matches most game display conventions.
  const rounded = Math.trunc(a.amount * multiplier + Math.sign(a.amount * multiplier) * 0.5);
  return { amount: rounded, currency: a.currency };
}

export function eqMoney(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount;
}

export function formatMoney(m: Money, fractionDigits = 2): string {
  const whole = m.amount / 10 ** fractionDigits;
  return `${whole.toFixed(fractionDigits)} ${m.currency}`;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}
