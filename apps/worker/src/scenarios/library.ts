import { type Scenario } from '@cacqa/core';

/**
 * Deterministic scenarios that every session runs first. They give us a
 * baseline of coverage before the LLM starts exploring — and they're cheap to
 * extend (one entry per case).
 *
 * Intro / overlay dismissal is handled by SessionRunner's pre-flight loop
 * (vision-driven, adaptive per game). It is not a library scenario.
 */
export const SCENARIO_LIBRARY: readonly Scenario[] = [
  {
    id: 'play.one-spin',
    name: 'Play: one spin / bet at minimum stake',
    category: 'golden-path',
    description:
      'Place a single bet at whatever stake is configured, wait for the round to resolve, and let the oracle check balance and payout invariants.',
    actions: [
      { type: 'place-bet' },
      // Typical slot animation is 3–5 s (reels spin, settle, any win animation).
      // Crash games resolve slower; this wait is a reasonable common denominator.
      { type: 'wait', milliseconds: 5000 },
    ],
    expectation: {
      description:
        'After the bet: balance should decrease by the bet amount; round outcome should resolve; if multiplier and bet are both visible, payout must match bet * multiplier.',
      ruleIds: [
        'balance-decreases-on-bet',
        'payout-matches-multiplier',
        'cash-out-available-mid-round',
      ],
    },
    origin: 'library',
  },
  {
    id: 'smoke.observe',
    name: 'Smoke: observe initial state',
    category: 'smoke',
    description: 'Land on the page and confirm the agent can read balance + UI.',
    actions: [{ type: 'wait', milliseconds: 1500 }],
    expectation: {
      description: 'A balance value should be present and at least one interactive element visible.',
      ruleIds: [],
    },
    origin: 'library',
  },
  {
    id: 'rapid.click.place-bet',
    name: 'Rapid clicks: place-bet x5',
    category: 'rapid-interaction',
    description: 'Fire five place-bet clicks back-to-back to surface debounce/race issues.',
    actions: Array.from({ length: 5 }, () => ({ type: 'place-bet' as const })),
    expectation: {
      description: 'Balance should decrement at most once; the UI must not enter an inconsistent state.',
      ruleIds: ['balance-decreases-on-bet'],
    },
    origin: 'library',
  },
  {
    id: 'network.offline-mid-round',
    name: 'Network: drop connection mid-round',
    category: 'network-interruption',
    description: 'Place a bet, take the network offline, then restore — observe recovery.',
    actions: [
      { type: 'place-bet' },
      { type: 'wait', milliseconds: 800 },
      { type: 'throttle-network', profile: 'offline' },
      { type: 'wait', milliseconds: 3000 },
      { type: 'throttle-network', profile: 'restore' },
      { type: 'wait', milliseconds: 2000 },
    ],
    expectation: {
      description: 'On reconnect the round should resolve or be refunded; balance must reconcile.',
      ruleIds: ['balance-stable-without-money-action'],
    },
    origin: 'library',
  },
];
