import { describe, expect, it } from 'vitest';
import {
  type Action,
  type GameState,
  type Scenario,
} from '@cacqa/core';

import { createDefaultOracle } from './rule-engine.js';

const baseState: GameState = {
  capturedAt: new Date(),
  balance: { amount: 10_000, currency: 'USD' },
  round: { outcome: 'pending' },
  elements: [],
  ocrText: '',
  screenshotRef: 'ref',
  dismissHint: null,
};

const baseScenario: Scenario = {
  id: 's',
  name: 's',
  category: 'smoke',
  description: '',
  actions: [{ type: 'wait', milliseconds: 1 }],
  expectation: { description: '', ruleIds: [] },
  origin: 'library',
};

describe('default oracle', () => {
  it('flags silent balance changes', () => {
    const oracle = createDefaultOracle();
    const after: GameState = {
      ...baseState,
      balance: { amount: 9_500, currency: 'USD' },
    };
    const result = oracle.evaluate({
      scenario: baseScenario,
      stateBefore: baseState,
      stateAfter: after,
      action: { type: 'wait', milliseconds: 100 },
    });
    expect(result.isOk()).toBe(true);
    const violations = result._unsafeUnwrap();
    expect(violations.map((v) => v.ruleId)).toContain('balance-stable-without-money-action');
  });

  it('does not flag balance changes after place-bet', () => {
    const oracle = createDefaultOracle();
    const after: GameState = {
      ...baseState,
      balance: { amount: 9_500, currency: 'USD' },
    };
    const action: Action = { type: 'place-bet' };
    const result = oracle.evaluate({
      scenario: baseScenario,
      stateBefore: baseState,
      stateAfter: after,
      action,
    });
    const violations = result._unsafeUnwrap();
    expect(violations.map((v) => v.ruleId)).not.toContain('balance-stable-without-money-action');
  });

  it('flags balance increase after place-bet', () => {
    const oracle = createDefaultOracle();
    const after: GameState = {
      ...baseState,
      balance: { amount: 11_000, currency: 'USD' },
    };
    const result = oracle.evaluate({
      scenario: baseScenario,
      stateBefore: baseState,
      stateAfter: after,
      action: { type: 'place-bet' },
    });
    const violations = result._unsafeUnwrap();
    expect(violations.map((v) => v.ruleId)).toContain('balance-decreases-on-bet');
  });
});
