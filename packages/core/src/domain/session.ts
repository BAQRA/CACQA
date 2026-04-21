import { z } from 'zod';

import { OrganizationIdSchema, SessionIdSchema } from './identifiers.js';

export const NetworkProfileSchema = z.enum(['offline', 'slow-3g', 'fast-3g', 'none']);
export type NetworkProfile = z.infer<typeof NetworkProfileSchema>;

/**
 * A session run is one invocation of the worker against a target game. It
 * captures everything the worker needs to execute reproducibly.
 */
export const SessionSpecSchema = z.object({
  sessionId: SessionIdSchema,
  organizationId: OrganizationIdSchema,
  targetUrl: z.string().url(),
  maxRounds: z.number().int().positive().default(50),
  maxDurationMs: z.number().int().positive().default(30 * 60 * 1000),
  viewport: z
    .object({
      width: z.number().int().min(320).max(3840),
      height: z.number().int().min(240).max(2160),
    })
    .default({ width: 1440, height: 900 }),
  /** Categories of scenarios to include. Empty means all. */
  scenarioCategories: z.array(z.string()).default([]),
  /** Optional path to a rules spec YAML/JSON — game-specific oracle input. */
  rulesSpecRef: z.string().optional(),
  randomSeed: z.number().int().optional(),
});
export type SessionSpec = z.infer<typeof SessionSpecSchema>;

export const SessionStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;
