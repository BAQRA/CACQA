import { z } from 'zod';

import { PointSchema } from './geometry.js';
import { MoneySchema } from './money.js';

/**
 * Actions describe intent at the domain level. The BrowserDriver adapter
 * translates them into Playwright calls. Anything specific to a browser
 * (selectors, keyboard codes) lives in the adapter, not here.
 */
export const ActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('click-element'),
    label: z.string(),
    /** If multiple elements match, pick by occurrence index. Absent = 0. */
    occurrence: z.number().int().nonnegative().optional(),
  }),
  z.object({
    /**
     * Best-effort click: succeeds silently when no matching element is
     * present. Use for dismissing tutorials, modals, or cookie banners that
     * may or may not appear on a given run.
     */
    type: z.literal('click-if-present'),
    label: z.string(),
    /** Max time to wait for the element before giving up (ms). */
    timeoutMs: z.number().int().positive().max(10_000).optional(),
  }),
  z.object({
    type: z.literal('click-point'),
    at: PointSchema,
  }),
  z.object({
    type: z.literal('set-bet'),
    amount: MoneySchema,
  }),
  z.object({
    type: z.literal('place-bet'),
  }),
  z.object({
    type: z.literal('cash-out'),
  }),
  z.object({
    type: z.literal('type-text'),
    label: z.string(),
    value: z.string(),
  }),
  z.object({
    type: z.literal('wait'),
    milliseconds: z.number().int().positive().max(60_000),
  }),
  z.object({
    type: z.literal('reload'),
  }),
  z.object({
    type: z.literal('throttle-network'),
    profile: z.enum(['offline', 'slow-3g', 'fast-3g', 'restore']),
  }),
  z.object({
    type: z.literal('open-new-tab'),
    url: z.string().url(),
  }),
]);
export type Action = z.infer<typeof ActionSchema>;
export type ActionType = Action['type'];
