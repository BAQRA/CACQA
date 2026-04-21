import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  errAsync,
  ResultAsync,
  StorageError,
  type Failure,
  type ListSessionsOptions,
  type Logger,
  type SessionId,
  type SessionRecord,
  type SessionRepository,
  type SessionSpec,
  type SessionStatus,
} from '@cacqa/core';

interface SerializedSessionRecord {
  readonly spec: SessionSpec;
  readonly status: SessionStatus;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly roundsCompleted: number;
  readonly failureCount: number;
}

interface SerializedFailure extends Omit<Failure, 'observedAt'> {
  readonly observedAt: string;
}

export interface FilesystemSessionRepositoryOptions {
  readonly rootDir: string;
  readonly logger: Logger;
}

/**
 * Disk-backed SessionRepository. Sessions and failures are persisted as JSON
 * under `<rootDir>/sessions/<id>/`:
 *
 *   session.json   — the SessionRecord (rewritten on every update)
 *   failures.json  — array of Failure objects (append-on-recordFailure)
 *
 * Deliberately simple: no DB, no locks, single-writer (the worker). The API
 * reads concurrently — writes are atomic because we rewrite the whole file.
 * When we move to Prisma, the port stays the same; callers don't change.
 */
export class FilesystemSessionRepository implements SessionRepository {
  private readonly rootDir: string;
  private readonly log: Logger;

  public constructor(opts: FilesystemSessionRepositoryOptions) {
    this.rootDir = resolve(opts.rootDir);
    this.log = opts.logger.child({ repo: 'filesystem-session' });
  }

  public create(spec: SessionSpec): ResultAsync<SessionRecord, StorageError> {
    const record: SessionRecord = {
      spec,
      status: 'queued',
      startedAt: null,
      endedAt: null,
      roundsCompleted: 0,
      failureCount: 0,
    };
    this.log.debug({ sessionId: spec.sessionId, target: spec.targetUrl }, 'session created');
    return this.writeSession(record)
      .andThen(() => this.writeFailures(spec.sessionId, []))
      .map(() => record);
  }

  public updateStatus(
    id: SessionId,
    status: SessionStatus,
    patch?: Partial<Pick<SessionRecord, 'startedAt' | 'endedAt' | 'roundsCompleted' | 'failureCount'>>,
  ): ResultAsync<SessionRecord, StorageError> {
    return this.readSession(id).andThen((existing) => {
      if (!existing) {
        return errAsync(new StorageError(`Session not found: ${id}`, { context: { id } }));
      }
      const updated: SessionRecord = { ...existing, ...patch, status };
      return this.writeSession(updated).map(() => updated);
    });
  }

  public findById(id: SessionId): ResultAsync<SessionRecord | null, StorageError> {
    return this.readSession(id);
  }

  public list(options: ListSessionsOptions = {}): ResultAsync<readonly SessionRecord[], StorageError> {
    const { limit = 100, offset = 0 } = options;
    return ResultAsync.fromPromise(
      (async () => {
        const sessionsDir = join(this.rootDir, 'sessions');
        const entries = await readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
        const ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);
        const records = await Promise.all(
          ids.map(async (id) => this.readSessionFile(id).catch(() => null)),
        );
        return records
          .filter((r): r is SessionRecord => r !== null)
          .sort((a, b) => {
            // Most-recently-updated first. Fall back to startedAt then never.
            const aTs = (a.endedAt ?? a.startedAt ?? new Date(0)).getTime();
            const bTs = (b.endedAt ?? b.startedAt ?? new Date(0)).getTime();
            return bTs - aTs;
          })
          .slice(offset, offset + limit);
      })(),
      (cause) => new StorageError('Failed to list sessions', { cause }),
    );
  }

  public recordFailure(failure: Failure): ResultAsync<void, StorageError> {
    return this.readFailures(failure.sessionId).andThen((existing) =>
      this.writeFailures(failure.sessionId, [...existing, failure]),
    );
  }

  public listFailures(id: SessionId): ResultAsync<readonly Failure[], StorageError> {
    return this.readFailures(id);
  }

  // ── private ────────────────────────────────────────────────────────────────

  private sessionFile(id: string): string {
    return join(this.rootDir, 'sessions', id, 'session.json');
  }

  private failuresFile(id: string): string {
    return join(this.rootDir, 'sessions', id, 'failures.json');
  }

  private writeSession(record: SessionRecord): ResultAsync<void, StorageError> {
    const file = this.sessionFile(record.spec.sessionId);
    const payload: SerializedSessionRecord = {
      spec: record.spec,
      status: record.status,
      startedAt: record.startedAt ? record.startedAt.toISOString() : null,
      endedAt: record.endedAt ? record.endedAt.toISOString() : null,
      roundsCompleted: record.roundsCompleted,
      failureCount: record.failureCount,
    };
    return this.writeJson(file, payload);
  }

  private readSession(id: SessionId): ResultAsync<SessionRecord | null, StorageError> {
    return ResultAsync.fromPromise(
      this.readSessionFile(id).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          return null;
        }
        throw err;
      }),
      (cause) => new StorageError(`Failed to read session ${id}`, { cause, context: { id } }),
    );
  }

  private async readSessionFile(id: string): Promise<SessionRecord> {
    const raw = await readFile(this.sessionFile(id), 'utf-8');
    const parsed = JSON.parse(raw) as SerializedSessionRecord;
    return {
      spec: parsed.spec,
      status: parsed.status,
      startedAt: parsed.startedAt ? new Date(parsed.startedAt) : null,
      endedAt: parsed.endedAt ? new Date(parsed.endedAt) : null,
      roundsCompleted: parsed.roundsCompleted,
      failureCount: parsed.failureCount,
    };
  }

  private readFailures(id: SessionId): ResultAsync<readonly Failure[], StorageError> {
    return ResultAsync.fromPromise(
      (async () => {
        const raw = await readFile(this.failuresFile(id), 'utf-8').catch((err: NodeJS.ErrnoException) => {
          if (err.code === 'ENOENT') {
            return '[]';
          }
          throw err;
        });
        const parsed = JSON.parse(raw) as SerializedFailure[];
        return parsed.map((f) => ({ ...f, observedAt: new Date(f.observedAt) } as Failure));
      })(),
      (cause) => new StorageError(`Failed to read failures for ${id}`, { cause, context: { id } }),
    );
  }

  private writeFailures(id: SessionId, failures: readonly Failure[]): ResultAsync<void, StorageError> {
    return this.writeJson(
      this.failuresFile(id),
      failures.map((f) => ({ ...f, observedAt: f.observedAt.toISOString() })),
    );
  }

  private writeJson(path: string, payload: unknown): ResultAsync<void, StorageError> {
    return ResultAsync.fromPromise(
      (async () => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify(payload, null, 2), 'utf-8');
      })(),
      (cause) => new StorageError(`Failed to write ${path}`, { cause, context: { path } }),
    );
  }
}
