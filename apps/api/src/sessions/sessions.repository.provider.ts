import { createLogger, type SessionRepository } from '@cacqa/core';
import { FilesystemSessionRepository } from '@cacqa/storage';
import { type Provider } from '@nestjs/common';

export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');

/**
 * Both API and worker read/write the SAME filesystem directory. The worker
 * is the sole writer (records session state + failures as it runs); the API
 * is a reader (serves the dashboard). Atomic file rewrites keep this safe
 * without explicit locking.
 *
 * When we swap to Prisma, replace this provider with one that constructs a
 * PrismaSessionRepository — call sites don't change.
 */
export const sessionRepositoryProvider: Provider = {
  provide: SESSION_REPOSITORY,
  useFactory: (): SessionRepository => {
    const rootDir = process.env['WORKER_ARTIFACT_DIR'] ?? './artifacts';
    const logger = createLogger({ service: 'api', component: 'session-repo' }, { pretty: false });
    return new FilesystemSessionRepository({ rootDir, logger });
  },
};
