/**
 * Standalone entrypoint: run ONE session against a target URL without going
 * through the queue. Use during local development to iterate on prompts,
 * rules, or scenarios.
 *
 * Usage:
 *   pnpm --filter @cacqa/worker exec tsx src/cli/run-once.ts <url>
 */
import '../bootstrap/load-env.js';

import { randomUUID } from 'node:crypto';

import {
  type OrganizationId,
  type SessionId,
  type SessionSpec,
} from '@cacqa/core';

import { buildContainer } from '../composition.js';
import { SessionRunner } from '../session/session-runner.js';

async function main(): Promise<void> {
  const targetUrl = process.argv[2];
  if (!targetUrl) {
    console.error('Usage: tsx src/cli/run-once.ts <target-url>');
    process.exit(1);
  }

  const container = buildContainer();
  const log = container.logger.child({ component: 'run-once' });

  // Allow the API (or any orchestrator) to pre-generate these IDs so the
  // caller can return them to a user BEFORE we finish writing the session.
  // When unset, we generate our own — keeps the CLI useful standalone.
  const sessionId = (process.env['CACQA_SESSION_ID'] ?? randomUUID()) as SessionId;
  const organizationId = (process.env['CACQA_ORGANIZATION_ID'] ?? randomUUID()) as OrganizationId;

  const spec: SessionSpec = {
    sessionId,
    organizationId,
    targetUrl,
    maxRounds: 1,
    maxDurationMs: 5 * 60 * 1000,
    viewport: { width: 1440, height: 900 },
    scenarioCategories: [],
    randomSeed: 1,
  };

  await container.repository.create(spec);

  const runner = new SessionRunner({
    browserFactory: container.browserFactory,
    vision: container.vision,
    llm: container.llm,
    oracle: container.oracle,
    repository: container.repository,
    artifacts: container.artifacts,
    logger: container.logger,
  });

  try {
    const result = await runner.run(spec);
    log.info(
      {
        sessionId: spec.sessionId,
        roundsCompleted: result.roundsCompleted,
        failures: result.failures.length,
        stoppedReason: result.stoppedReason,
      },
      'run-once finished',
    );
    for (const failure of result.failures) {
      log.warn({ failure }, 'failure');
    }
  } finally {
    await container.shutdown();
  }
}

main().catch((err: unknown) => {
  console.error('run-once failed:', err);
  process.exit(1);
});
