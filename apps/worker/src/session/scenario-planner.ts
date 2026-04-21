import {
  type Failure,
  type GameState,
  type LLMProvider,
  type Logger,
  type Scenario,
  type ScenarioCategory,
} from '@cacqa/core';

import { SCENARIO_LIBRARY } from '../scenarios/library.js';

export interface PlanInput {
  readonly state: GameState;
  readonly recentFailures: readonly Failure[];
  readonly executedScenarioIds: readonly string[];
  readonly desiredCategory: ScenarioCategory | null;
}

/**
 * The planner picks the next scenario to run. Strategy:
 *   1. Drain the deterministic library first — cheap, high-signal coverage.
 *   2. Then ask the LLM to generate exploratory scenarios, biased toward
 *      categories where we've seen recent failures (the "press where it
 *      hurts" heuristic).
 *
 * If the LLM fails (rate-limit, schema violation), we fall back to a random
 * library replay so the session keeps making progress.
 */
export class ScenarioPlanner {
  public constructor(
    private readonly llm: LLMProvider,
    private readonly logger: Logger,
  ) {}

  public async nextScenario(input: PlanInput): Promise<Scenario> {
    const log = this.logger.child({ planner: 'scenario' });
    const next = SCENARIO_LIBRARY.find((s) => !input.executedScenarioIds.includes(s.id));
    if (next) {
      log.debug({ scenarioId: next.id }, 'using library scenario');
      return next;
    }

    const result = await this.llm.generateScenario({
      state: input.state,
      recentScenarios: input.executedScenarioIds.slice(-5),
      desiredCategory: input.desiredCategory ?? this.biasFromFailures(input.recentFailures),
      recentFailures: input.recentFailures.slice(-3),
    });

    if (result.isOk()) {
      log.info({ scenarioId: result.value.scenario.id, usage: result.value.usage }, 'LLM scenario generated');
      return result.value.scenario;
    }

    log.warn({ err: result.error }, 'LLM scenario generation failed; falling back to library replay');
    const fallback = SCENARIO_LIBRARY[input.executedScenarioIds.length % SCENARIO_LIBRARY.length];
    if (!fallback) {
      // Should be impossible — library is non-empty by construction.
      throw new Error('Scenario library is empty');
    }
    return fallback;
  }

  private biasFromFailures(failures: readonly Failure[]): ScenarioCategory | null {
    if (failures.length === 0) {
      return null;
    }
    const last = failures[failures.length - 1];
    if (!last) {
      return null;
    }
    if (last.ruleId.includes('payout')) {
      return 'edge-case';
    }
    if (last.ruleId.includes('balance')) {
      return 'rapid-interaction';
    }
    return 'exploratory';
  }
}
