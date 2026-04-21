import {
  type ArtifactStore,
  type BrowserDriver,
  type BrowserDriverFactory,
  type Failure,
  type GameState,
  type LLMProvider,
  type Logger,
  type Oracle,
  type SessionId,
  type SessionRepository,
  type SessionSpec,
  type VisionService,
} from '@cacqa/core';

import { ScenarioPlanner } from './scenario-planner.js';
import { ScenarioRunner } from './scenario-runner.js';
import { StateObserver } from './state-observer.js';

export interface SessionRunnerDeps {
  readonly browserFactory: BrowserDriverFactory;
  readonly vision: VisionService;
  readonly llm: LLMProvider;
  readonly oracle: Oracle;
  readonly repository: SessionRepository;
  readonly artifacts: ArtifactStore;
  readonly logger: Logger;
}

export interface SessionRunResult {
  readonly roundsCompleted: number;
  readonly failures: readonly Failure[];
  readonly stoppedReason: 'max-rounds' | 'max-duration' | 'fatal-error';
}

/**
 * Top-level session runner. Owns the lifecycle of one BrowserDriver, runs
 * scenarios sequentially against it, and reports a result the queue can act on.
 *
 * Scenarios are sequential by design: a session targets ONE game tab. To run
 * many sessions in parallel, scale workers — that's what the queue is for.
 */
export class SessionRunner {
  public constructor(private readonly deps: SessionRunnerDeps) {}

  public async run(spec: SessionSpec): Promise<SessionRunResult> {
    const log = this.deps.logger.child({ sessionId: spec.sessionId, target: spec.targetUrl });
    const startedAt = Date.now();

    await this.deps.repository.updateStatus(spec.sessionId, 'running', { startedAt: new Date() });

    let driver: BrowserDriver | null = null;
    const failures: Failure[] = [];
    const executedScenarioIds: string[] = [];
    let roundsCompleted = 0;
    let stoppedReason: SessionRunResult['stoppedReason'] = 'max-rounds';
    // Track whether we exited cleanly or via a fatal branch, so the finally
    // block writes the correct terminal status. Every early-return path flips
    // this false; the default (true) covers the happy max-rounds path.
    let completedCleanly = true;

    try {
      driver = await this.deps.browserFactory.create({
        viewport: spec.viewport,
      });

      const navResult = await driver.navigate(spec.targetUrl);
      if (navResult.isErr()) {
        log.error({ err: navResult.error }, 'navigation failed; aborting session');
        stoppedReason = 'fatal-error';
        completedCleanly = false;
        return { roundsCompleted, failures, stoppedReason };
      }

      const observer = new StateObserver(
        driver,
        this.deps.vision,
        this.deps.llm,
        this.deps.artifacts,
        this.deps.logger,
      );
      const planner = new ScenarioPlanner(this.deps.llm, this.deps.logger);
      const runner = new ScenarioRunner(
        observer,
        driver,
        this.deps.oracle,
        this.deps.repository,
        this.deps.artifacts,
        this.deps.logger,
      );

      const initialObs = await observer.observe({
        sessionId: spec.sessionId,
        roundIndex: 0,
        priorState: null,
        label: 'initial',
      });
      if (initialObs.isErr()) {
        log.error({ err: initialObs.error }, 'initial observation failed');
        stoppedReason = 'fatal-error';
        completedCleanly = false;
        return { roundsCompleted, failures, stoppedReason };
      }
      let lastState = initialObs.value.state;

      // Pre-flight: casino games always open with a blocking overlay (intro,
      // tutorial, cookie, "click anywhere"). Loop until the vision layer
      // reports the game is playable (dismissHint = null) or we give up.
      lastState = await this.dismissOverlays(lastState, observer, driver, spec.sessionId, log);

      for (let round = 1; round <= spec.maxRounds; round++) {
        if (Date.now() - startedAt > spec.maxDurationMs) {
          stoppedReason = 'max-duration';
          break;
        }

        const scenario = await planner.nextScenario({
          state: lastState,
          recentFailures: failures.slice(-5),
          executedScenarioIds,
          desiredCategory: null,
        });

        log.info({ round, scenarioId: scenario.id, category: scenario.category }, 'starting scenario');
        const result = await runner.run({
          sessionId: spec.sessionId,
          roundIndex: round,
          scenario,
          priorState: lastState,
        });

        executedScenarioIds.push(scenario.id);
        failures.push(...result.violations);
        lastState = result.stateAfter;
        roundsCompleted = round;
      }

      log.info({ roundsCompleted, failureCount: failures.length, stoppedReason }, 'session completed');

      // Headful dev mode: keep the window open so the human can poke at the
      // game (try clicking the button manually, open DevTools, etc.) before
      // we tear down. A quick way to tell "is it our code or the game".
      const holdOpenMs = Number(process.env['WORKER_HOLD_OPEN_MS'] ?? 0);
      if (holdOpenMs > 0) {
        log.info({ holdOpenMs }, 'holding browser open for inspection');
        await new Promise((r) => setTimeout(r, holdOpenMs));
      }

      return { roundsCompleted, failures, stoppedReason };
    } catch (err) {
      log.error({ err }, 'session crashed');
      completedCleanly = false;
      stoppedReason = 'fatal-error';
      return { roundsCompleted, failures, stoppedReason: 'fatal-error' };
    } finally {
      // Single source of truth for terminal status — runs on every exit path
      // including early returns for nav/observation failure and thrown errors.
      // Without this, sessions that died mid-flight stayed "running" forever
      // on the dashboard.
      const finalStatus = completedCleanly ? 'completed' : 'failed';
      await this.deps.repository.updateStatus(spec.sessionId, finalStatus, {
        endedAt: new Date(),
        roundsCompleted,
        failureCount: failures.length,
      });

      if (driver) {
        await driver.close();
      }
    }
  }

  /**
   * Iteratively dismiss blocking overlays (intros, tutorials, modals, cookie
   * banners) using the LLM's `dismissHint` coordinates from state extraction.
   * Stops when the LLM reports the game is playable, when we can't observe,
   * or after a fixed number of attempts (failsafe against infinite loops).
   */
  private async dismissOverlays(
    initial: GameState,
    observer: StateObserver,
    driver: BrowserDriver,
    sessionId: SessionId,
    log: Logger,
  ): Promise<GameState> {
    const maxAttempts = 3;
    let state = initial;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const hint = state.dismissHint;
      if (!hint) {
        if (attempt === 1) {
          log.debug('no overlay detected; skipping pre-flight dismissal');
        } else {
          log.info({ attempts: attempt - 1 }, 'overlays dismissed; game is playable');
        }
        return state;
      }

      log.info({ attempt, hint }, 'dismissing overlay');
      const clickResult = await driver.clickPoint(hint.at);
      if (clickResult.isErr()) {
        log.warn({ err: clickResult.error, hint }, 'dismiss click failed; giving up on pre-flight');
        return state;
      }

      // Give the game a beat to react — modals typically animate out over ~800ms.
      await new Promise((r) => setTimeout(r, 1200));

      const obs = await observer.observe({
        sessionId,
        roundIndex: -attempt, // negative index distinguishes pre-flight screenshots
        priorState: state,
        label: `after-dismiss`,
      });
      if (obs.isErr()) {
        log.warn({ err: obs.error }, 'observation failed during pre-flight; proceeding with last state');
        return state;
      }
      state = obs.value.state;
    }

    log.warn({ maxAttempts }, 'pre-flight dismissal gave up; overlay may still be present');
    return state;
  }
}
