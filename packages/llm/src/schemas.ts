import {
  ActionSchema,
  BoundingBoxSchema,
  DismissHintSchema,
  ExpectationSchema,
  MoneySchema,
  RoundInfoSchema,
  ScenarioCategorySchema,
  UIElementSchema,
} from '@cacqa/core';
import { z } from 'zod';

/**
 * Response contract from the LLM when asked to interpret a screenshot.
 * We deliberately keep fields optional and null-friendly: the model should
 * omit rather than invent when it isn't sure.
 */
export const ExtractStateResponseSchema = z.object({
  balance: MoneySchema.nullable(),
  round: RoundInfoSchema.nullable(),
  elements: z.array(UIElementSchema.extend({ bounds: BoundingBoxSchema })),
  dismissHint: DismissHintSchema.nullable(),
  notes: z.string().optional(),
});
export type ExtractStateResponse = z.infer<typeof ExtractStateResponseSchema>;

/**
 * Response contract when asking the LLM to propose the next scenario.
 * We constrain it to a bounded set of actions to keep the action space safe.
 */
export const GenerateScenarioResponseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: ScenarioCategorySchema,
  description: z.string(),
  actions: z.array(ActionSchema).min(1).max(20),
  expectation: ExpectationSchema,
});
export type GenerateScenarioResponse = z.infer<typeof GenerateScenarioResponseSchema>;

export const AnalyzeFailureResponseSchema = z.object({
  hypothesis: z.string(),
  reproductionSteps: z.array(z.string()),
  likelyCategory: z.enum(['display-bug', 'logic-bug', 'race-condition', 'network', 'unknown']),
  confidence: z.number().min(0).max(1),
});
export type AnalyzeFailureResponse = z.infer<typeof AnalyzeFailureResponseSchema>;
