import { z } from 'zod';

import { ActionSchema } from './action.js';

/**
 * A Scenario is a named, ordered sequence of actions with an expectation about
 * the observable outcome. Scenarios come from two sources:
 *   1. Deterministic library (golden paths, known edge cases).
 *   2. LLM-generated (exploratory, targeting suspicious state).
 */
export const ScenarioCategorySchema = z.enum([
  'smoke',
  'golden-path',
  'edge-case',
  'invalid-input',
  'rapid-interaction',
  'network-interruption',
  'multi-tab',
  'exploratory',
]);
export type ScenarioCategory = z.infer<typeof ScenarioCategorySchema>;

export const ExpectationSchema = z.object({
  /** Natural-language description; the oracle interprets structured assertions below. */
  description: z.string(),
  /** Balance should not move by more than this in absolute value (in smallest unit). */
  maxBalanceDelta: z.number().int().nonnegative().optional(),
  /** Whether the scenario is expected to trigger an error state. */
  shouldErrorGracefully: z.boolean().optional(),
  /** Arbitrary rule keys the oracle should enforce (e.g. 'payout-matches-multiplier'). */
  ruleIds: z.array(z.string()).optional(),
});
export type Expectation = z.infer<typeof ExpectationSchema>;

export const ScenarioSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: ScenarioCategorySchema,
  description: z.string(),
  actions: z.array(ActionSchema).min(1),
  expectation: ExpectationSchema,
  /** Source that produced this scenario — used for telemetry and bias detection. */
  origin: z.enum(['library', 'llm-generated']),
});
export type Scenario = z.infer<typeof ScenarioSchema>;
