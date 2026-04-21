import { z } from 'zod';

import { RoundIdSchema, SessionIdSchema } from './identifiers.js';

export const SeveritySchema = z.enum(['info', 'low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof SeveritySchema>;

/**
 * Failures are what the dashboard and alerting systems consume. They must be
 * reproducible — every failure carries enough context (scenario, state before,
 * state after, screenshots) to rerun or hand off to a human.
 */
export const FailureSchema = z.object({
  sessionId: SessionIdSchema,
  roundId: RoundIdSchema.optional(),
  scenarioId: z.string(),
  severity: SeveritySchema,
  ruleId: z.string(),
  message: z.string(),
  observedAt: z.date(),
  /** Refs into the artifact store — not inline bytes, to keep DB rows small. */
  artifacts: z.object({
    screenshotBefore: z.string().optional(),
    screenshotAfter: z.string().optional(),
    stateBefore: z.string().optional(),
    stateAfter: z.string().optional(),
  }),
  /** Arbitrary structured payload for rule-specific data. */
  metadata: z.record(z.unknown()).default({}),
});
export type Failure = z.infer<typeof FailureSchema>;
