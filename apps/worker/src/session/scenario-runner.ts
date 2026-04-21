import { randomUUID } from 'node:crypto';

import {
  centerOf,
  type Action,
  type ArtifactStore,
  type BrowserDriver,
  type Failure,
  type GameState,
  type Logger,
  type Oracle,
  type RoundId,
  type Scenario,
  type SessionId,
  type SessionRepository,
  type UIElement,
} from '@cacqa/core';

import { type StateObserver } from './state-observer.js';

/**
 * Casino games split roughly into two rendering styles:
 *
 *   - DOM-accessible (cookie banners, some older HTML games): ARIA
 *     `getByRole('button')` works.
 *   - Canvas/WebGL (Pragmatic, EGT, most modern games): only pixels exist,
 *     ARIA finds nothing; we MUST click coordinates.
 *
 * `resolveAction` looks up the action's semantic target in the state extracted
 * by the vision LLM and, if found, substitutes a `click-point`. Falls through
 * to ARIA-based clicks when no visual match exists.
 *
 * IMPORTANT: the RAW semantic action (`place-bet`, `cash-out`, …) is what the
 * oracle evaluates. Only the executed action is transformed. That separation
 * lets invariants like `balance-decreases-on-bet` keep firing regardless of
 * the physical click mechanism.
 */
function resolveAction(
  action: Action,
  state: GameState,
  logger?: Logger,
): Action {
  const candidates = semanticLabelCandidates(action);
  if (!candidates) {
    return action;
  }
  // For semantic money actions (place-bet, cash-out) we MUST NOT click
  // decorative imagery or text readouts — the LLM often tags banners like
  // "4Spins Boost" or labels like "Min Bet: 0.10". Restrict to interactive
  // kinds and fall through to ARIA on no match.
  //
  // For user-supplied labels via `click-element` / `click-if-present` the
  // user already expressed intent, so we allow any element kind.
  const interactiveOnly = action.type === 'place-bet' || action.type === 'cash-out';

  for (const label of candidates) {
    const match = findMatchingElement(state.elements, label, interactiveOnly);
    if (match) {
      logger?.debug(
        {
          semantic: action.type,
          matchedLabel: match.label,
          matchedKind: match.kind,
          matchedViaCandidate: label,
          bounds: match.bounds,
          interactiveOnly,
        },
        'resolveAction: semantic → click-point',
      );
      return { type: 'click-point', at: centerOf(match.bounds) };
    }
  }
  logger?.debug(
    { semantic: action.type, candidates, interactiveOnly },
    'resolveAction: no matching element in state; falling through to raw action',
  );
  return action;
}

/**
 * For each resolvable action, a list of labels (regex-ish fragments) to look
 * up in the current state. Order = preference; the first match wins.
 */
function semanticLabelCandidates(action: Action): readonly string[] | null {
  switch (action.type) {
    case 'click-element':
    case 'click-if-present':
      return [action.label];
    case 'place-bet':
      return ['spin', 'place bet', 'bet', 'play', 'start'];
    case 'cash-out':
      return ['cash out', 'cashout', 'collect', 'take win'];
    default:
      return null;
  }
}

/**
 * Canvas games cover the viewport with a single element, so picking WHICH
 * element to click is more delicate than on DOM-accessible pages. Vision
 * LLMs cheerfully return text readouts ("min bet: 0.10", "balance: 50.00")
 * alongside real buttons. Substring matching `"bet"` against those text
 * elements would send us clicking on a label, not a control.
 *
 * Fix: bias strongly toward elements the LLM tagged as interactive
 * (button/checkbox/toggle/slider/link/icon). Only fall back to text or
 * image elements when no interactive match exists.
 */
const INTERACTIVE_KINDS = new Set<UIElement['kind']>([
  'button',
  'checkbox',
  'toggle',
  'slider',
  'link',
  'icon',
]);

function findMatchingElement(
  elements: readonly UIElement[],
  pattern: string,
  interactiveOnly: boolean,
): UIElement | undefined {
  const tester = buildTester(pattern);
  const matches = elements.filter((e) => tester(e.label));
  if (matches.length === 0) {
    return undefined;
  }
  const interactive = matches.find((e) => INTERACTIVE_KINDS.has(e.kind));
  if (interactive) {
    return interactive;
  }
  return interactiveOnly ? undefined : matches[0];
}

/**
 * Builds a label-predicate that tries the pattern as a regex first (so
 * "let.?s play" and similar shortcuts work), then falls back to a
 * case-insensitive substring. Malformed regex silently uses substring only.
 */
function buildTester(pattern: string): (label: string) => boolean {
  let regex: RegExp | null = null;
  try {
    regex = new RegExp(pattern, 'i');
  } catch {
    /* malformed pattern → substring-only */
  }
  const lowered = pattern.toLowerCase();
  return (label) => (regex?.test(label) ?? false) || label.toLowerCase().includes(lowered);
}

export interface RunScenarioInput {
  readonly sessionId: SessionId;
  readonly roundIndex: number;
  readonly scenario: Scenario;
  readonly priorState: GameState;
}

export interface RunScenarioResult {
  readonly roundId: RoundId;
  readonly stateAfter: GameState;
  readonly violations: readonly Failure[];
}

/**
 * Executes one scenario end-to-end:
 *   - For each action: snapshot state -> execute -> snapshot state -> oracle.
 *   - Collects violations as Failures with linked artifacts.
 *
 * We deliberately observe BEFORE and AFTER each action (not just at scenario
 * boundary) so the oracle can pinpoint which action caused a divergence.
 */
export class ScenarioRunner {
  public constructor(
    private readonly observer: StateObserver,
    private readonly browser: BrowserDriver,
    private readonly oracle: Oracle,
    private readonly repository: SessionRepository,
    private readonly artifacts: ArtifactStore,
    private readonly logger: Logger,
  ) {}

  public async run(input: RunScenarioInput): Promise<RunScenarioResult> {
    const log = this.logger.child({
      sessionId: input.sessionId,
      roundIndex: input.roundIndex,
      scenarioId: input.scenario.id,
    });
    const roundId = randomUUID() as RoundId;
    let current: GameState = input.priorState;
    const violations: Failure[] = [];

    for (let i = 0; i < input.scenario.actions.length; i++) {
      const rawAction = input.scenario.actions[i];
      if (!rawAction) {
        continue;
      }
      const executedAction = resolveAction(rawAction, current, log);
      log.debug(
        {
          actionIndex: i,
          semantic: rawAction.type,
          executed: executedAction.type,
          resolved: rawAction.type !== executedAction.type,
        },
        'executing action',
      );

      const before = current;
      const execResult = await this.browser.executeAction(executedAction);
      if (execResult.isErr()) {
        const failure = this.toExecutionFailure(input, roundId, rawAction, execResult.error.message);
        await this.persistFailure(failure);
        violations.push(failure);
        // Halt this scenario but keep the session alive — next scenario gets a fresh attempt.
        break;
      }

      const observation = await this.observer.observe({
        sessionId: input.sessionId,
        roundIndex: input.roundIndex,
        priorState: before,
        label: `action-${i}-after-${rawAction.type}`,
      });
      if (observation.isErr()) {
        log.warn({ err: observation.error }, 'observation failed mid-scenario; continuing with prior state');
        continue;
      }
      current = observation.value.state;

      const verdict = this.oracle.evaluate({
        scenario: input.scenario,
        stateBefore: before,
        stateAfter: current,
        // Oracle sees SEMANTIC intent (`place-bet`), not the physical click
        // we dispatched. This keeps rule predicates like
        // `action.type === 'place-bet'` working across DOM and Canvas games.
        action: rawAction,
      });
      if (verdict.isErr()) {
        log.warn({ err: verdict.error }, 'oracle errored; skipping rule check');
        continue;
      }
      for (const v of verdict.value) {
        const failure: Failure = {
          sessionId: input.sessionId,
          roundId,
          scenarioId: input.scenario.id,
          severity: v.severity,
          ruleId: v.ruleId,
          message: v.message,
          observedAt: new Date(),
          artifacts: {
            screenshotBefore: before.screenshotRef,
            screenshotAfter: current.screenshotRef,
          },
          metadata: { action: rawAction.type, executed: executedAction.type, ...v.metadata },
        };
        await this.persistFailure(failure);
        violations.push(failure);
      }
    }

    return { roundId, stateAfter: current, violations };
  }

  private toExecutionFailure(
    input: RunScenarioInput,
    roundId: RoundId,
    action: Action,
    message: string,
  ): Failure {
    return {
      sessionId: input.sessionId,
      roundId,
      scenarioId: input.scenario.id,
      severity: 'medium',
      ruleId: 'action-execution-failed',
      message: `Action ${action.type} failed: ${message}`,
      observedAt: new Date(),
      artifacts: { screenshotBefore: input.priorState.screenshotRef },
      metadata: { action: action.type },
    };
  }

  private async persistFailure(failure: Failure): Promise<void> {
    const result = await this.repository.recordFailure(failure);
    if (result.isErr()) {
      this.logger.error({ err: result.error, failure }, 'failed to persist failure');
    }
  }
}
