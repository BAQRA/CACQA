import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, openSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  type OrganizationId,
  type SessionId,
  type SessionRepository,
  type SessionSpec,
} from '@cacqa/core';

import { type CreateSessionRequest, type CreateSessionResponse } from './sessions.dto.js';
import { SESSION_REPOSITORY } from './sessions.repository.provider.js';

/**
 * Spawns the worker as a detached subprocess for each session. We pre-generate
 * the session id so the caller gets it back BEFORE the worker finishes — the
 * dashboard navigates straight to the detail page and watches progress.
 *
 * This is the MVP shape. Production wants BullMQ + a pool of persistent worker
 * processes; the repository port is already designed for that swap.
 */
@Injectable()
export class SessionsService {
  private readonly workerDir: string;

  public constructor(
    @Inject(SESSION_REPOSITORY) private readonly repository: SessionRepository,
  ) {
    // apps/api/src/sessions/sessions.service.ts → apps/worker
    const here = dirname(fileURLToPath(import.meta.url));
    this.workerDir = resolve(here, '..', '..', '..', 'worker');
  }

  public async createSession(req: CreateSessionRequest): Promise<CreateSessionResponse> {
    const sessionId = randomUUID() as SessionId;
    const organizationId = req.organizationId as OrganizationId;
    const spec: SessionSpec = {
      sessionId,
      organizationId,
      targetUrl: req.targetUrl,
      maxRounds: req.maxRounds,
      maxDurationMs: req.maxDurationMs,
      viewport: req.viewport ?? { width: 1440, height: 900 },
      scenarioCategories: [],
    };

    // Persist the session record up-front so the dashboard can see "queued"
    // immediately on navigation. The worker process will update it as it runs.
    const created = await this.repository.create(spec);
    if (created.isErr()) {
      throw new InternalServerErrorException(created.error.message);
    }

    // Per-session log. Lets us (and the dashboard, later) see what the
    // subprocess is doing instead of flying blind with `stdio: 'ignore'`.
    const artifactRoot = process.env['WORKER_ARTIFACT_DIR'] ?? './artifacts';
    const sessionDir = join(artifactRoot, 'sessions', sessionId);
    mkdirSync(sessionDir, { recursive: true });
    const stdoutFd = openSync(join(sessionDir, 'worker.log'), 'a');
    const stderrFd = openSync(join(sessionDir, 'worker.log'), 'a');

    const child = spawn(
      'pnpm',
      ['exec', 'tsx', 'src/cli/run-once.ts', req.targetUrl],
      {
        cwd: this.workerDir,
        env: {
          ...process.env,
          CACQA_SESSION_ID: sessionId,
          CACQA_ORGANIZATION_ID: organizationId,
        },
        detached: true,
        stdio: ['ignore', stdoutFd, stderrFd],
      },
    );
    // Detach so the worker outlives this HTTP request's lifecycle.
    child.unref();

    return { sessionId, jobId: String(child.pid), status: 'queued' };
  }
}
