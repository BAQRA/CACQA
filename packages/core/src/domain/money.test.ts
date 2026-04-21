import { describe, expect, it } from 'vitest';

import { addMoney, eqMoney, formatMoney, mulMoney, subMoney, ZERO } from './money.js';

describe('money', () => {
  it('adds values of the same currency', () => {
    expect(addMoney({ amount: 100, currency: 'USD' }, { amount: 50, currency: 'USD' })).toEqual({
      amount: 150,
      currency: 'USD',
    });
  });

  it('throws on currency mismatch', () => {
    expect(() =>
      addMoney({ amount: 1, currency: 'USD' }, { amount: 1, currency: 'EUR' }),
    ).toThrowError(/Currency mismatch/);
  });

  it('multiplies and rounds half-away-from-zero', () => {
    // 13 * 1.5 = 19.5 exactly (1.5 is binary-exact); rounds to 20 away from zero.
    expect(mulMoney({ amount: 13, currency: 'USD' }, 1.5)).toEqual({
      amount: 20,
      currency: 'USD',
    });
    expect(mulMoney({ amount: -13, currency: 'USD' }, 1.5)).toEqual({
      amount: -20,
      currency: 'USD',
    });
  });

  it('subtracts, compares equality, formats, and provides zero', () => {
    expect(subMoney({ amount: 100, currency: 'USD' }, { amount: 30, currency: 'USD' })).toEqual({
      amount: 70,
      currency: 'USD',
    });
    expect(eqMoney(ZERO('USD'), { amount: 0, currency: 'USD' })).toBe(true);
    expect(formatMoney({ amount: 12345, currency: 'USD' })).toBe('123.45 USD');
  });
});
