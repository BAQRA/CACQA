import { z } from 'zod';

export const CreateSessionRequestSchema = z.object({
  targetUrl: z.string().url(),
  organizationId: z.string().uuid(),
  maxRounds: z.number().int().positive().max(500).default(50),
  maxDurationMs: z.number().int().positive().max(2 * 60 * 60 * 1000).default(30 * 60 * 1000),
  viewport: z
    .object({
      width: z.number().int().min(320).max(3840),
      height: z.number().int().min(240).max(2160),
    })
    .optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export interface CreateSessionResponse {
  readonly sessionId: string;
  readonly jobId: string;
  readonly status: 'queued';
}
