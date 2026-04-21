import './bootstrap/load-env.js';

import { Worker, type Job } from 'bullmq';

import { buildContainer } from './composition.js';
import { QUEUE_NAME, type RunSessionJobPayload } from './queue/job-types.js';
import { createRedisConnection } from './queue/redis.js';
import { SessionRunner } from './session/session-runner.js';

async function main(): Promise<void> {
  const container = buildContainer();
  const log = container.logger.child({ component: 'worker-bootstrap' });

  const sessionRunner = new SessionRunner({
    browserFactory: container.browserFactory,
    vision: container.vision,
    llm: container.llm,
    oracle: container.oracle,
    repository: container.repository,
    artifacts: container.artifacts,
    logger: container.logger,
  });

  const connection = createRedisConnection(container.env.REDIS_URL);

  const worker = new Worker<RunSessionJobPayload>(
    QUEUE_NAME,
    async (job: Job<RunSessionJobPayload>) => {
      const result = await sessionRunner.run(job.data.spec);
      return {
        roundsCompleted: result.roundsCompleted,
        failureCount: result.failures.length,
        stoppedReason: result.stoppedReason,
      };
    },
    {
      connection,
      concurrency: container.env.WORKER_CONCURRENCY,
      // Long-running browser jobs need a larger lock; bumped from default 30s.
      lockDuration: 60_000,
    },
  );

  worker.on('completed', (job, result) => {
    log.info({ jobId: job.id, result }, 'job completed');
  });
  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'job failed');
  });
  worker.on('error', (err) => {
    log.error({ err }, 'worker error');
  });

  log.info(
    {
      queue: QUEUE_NAME,
      concurrency: container.env.WORKER_CONCURRENCY,
      llm: container.llm.name,
    },
    'worker ready',
  );

  // Graceful shutdown — close the queue, drain in-flight jobs, kill the browser.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log.info({ signal }, 'shutting down worker');
    try {
      await worker.close();
      await container.shutdown();
      await connection.quit();
    } catch (err) {
      log.error({ err }, 'error during shutdown');
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  // Boot failure: the logger may not exist yet, so write to stderr.
  // eslint-disable-next-line no-console
  console.error('Worker boot failed:', err);
  process.exit(1);
});
