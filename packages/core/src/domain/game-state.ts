import { z } from 'zod';

import { BoundingBoxSchema } from './geometry.js';
import { MoneySchema } from './money.js';

/**
 * A UIElement is something visible on screen that the agent may interact with
 * or compare against. The label is normalized (lowercased, trimmed) so rule
 * checks like `label === 'cash out'` are stable.
 */
export const UIElementSchema = z.object({
  label: z.string(),
  /**
   * Broad bucket the element falls into. Unknown buckets from the vision
   * layer are funnelled into 'unknown' rather than rejected — the universe of
   * widgets in casino games is too wide to enumerate exhaustively.
   */
  kind: z
    .enum([
      'button',
      'text',
      'input',
      'image',
      'checkbox',
      'toggle',
      'slider',
      'link',
      'icon',
      'unknown',
    ])
    .catch('unknown'),
  bounds: BoundingBoxSchema,
  /** Absent = assume enabled (innocent until proven disabled). */
  enabled: z.boolean().optional(),
  /** Absent = the adapter didn't report a confidence; treat as 1. */
  confidence: z.number().min(0).max(1).optional(),
});
export type UIElement = z.infer<typeof UIElementSchema>;

/**
 * Per-round information extracted from the screen. Fields are optional because
 * different games expose different things — the oracle only checks what's
 * present.
 */
export const RoundInfoSchema = z.object({
  // Using .nullish() (accepts both null and undefined) — LLMs often emit
  // explicit nulls for absent fields, even when the prompt says "omit".
  betAmount: MoneySchema.nullish(),
  multiplier: z.number().nonnegative().nullish(),
  outcome: z.enum(['pending', 'win', 'loss', 'cashed-out', 'crashed']).nullish(),
  payout: MoneySchema.nullish(),
});
export type RoundInfo = z.infer<typeof RoundInfoSchema>;

/**
 * A hint from the vision layer that the current screen is a blocking overlay
 * (intro, tutorial, modal, cookie banner, "click anywhere" prompt, etc.) and
 * that clicking at this coordinate is the most promising way to get past it.
 *
 * When `dismissHint` is non-null on a GameState, the session runner should
 * prefer pre-flight dismissal over running test scenarios.
 */
export const DismissHintSchema = z.object({
  at: z.object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
  }),
  /** Short LLM-provided rationale, used for logs and failure artifacts. */
  reason: z.string(),
});
export type DismissHint = z.infer<typeof DismissHintSchema>;

/**
 * The canonical snapshot of "what's on screen right now", as derived from
 * vision + OCR + LLM. Everything downstream (oracle, scenario generator,
 * reporter) consumes this — not the raw screenshot.
 */
export const GameStateSchema = z.object({
  capturedAt: z.date(),
  balance: MoneySchema.nullable(),
  round: RoundInfoSchema.nullable(),
  elements: z.array(UIElementSchema),
  /** Raw OCR text dump; keep for debugging and audit trails. */
  ocrText: z.string(),
  /** Path or ArtifactId pointing at the screenshot that produced this state. */
  screenshotRef: z.string(),
  /** If non-null, the game isn't yet in a playable state — dismiss first. */
  dismissHint: DismissHintSchema.nullable(),
});
export type GameState = z.infer<typeof GameStateSchema>;

export function findElementByLabel(state: GameState, label: string): UIElement | undefined {
  const normalized = label.trim().toLowerCase();
  return state.elements.find((e) => e.label.trim().toLowerCase() === normalized);
}
