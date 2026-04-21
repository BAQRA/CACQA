import { type StorageError } from '../errors.js';
import { type ResultAsync } from '../result.js';
import { type Failure } from '../domain/failure.js';
import { type SessionId } from '../domain/identifiers.js';
import { type SessionSpec, type SessionStatus } from '../domain/session.js';

export interface SessionRecord {
  readonly spec: SessionSpec;
  readonly status: SessionStatus;
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
  readonly roundsCompleted: number;
  readonly failureCount: number;
}

export interface ListSessionsOptions {
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Port: durable store of session metadata and failures. The worker writes
 * progress here; the API reads for the dashboard. Both processes MUST share
 * an implementation (filesystem directory, database, etc.).
 */
export interface SessionRepository {
  create(spec: SessionSpec): ResultAsync<SessionRecord, StorageError>;
  updateStatus(
    id: SessionId,
    status: SessionStatus,
    patch?: Partial<Pick<SessionRecord, 'startedAt' | 'endedAt' | 'roundsCompleted' | 'failureCount'>>,
  ): ResultAsync<SessionRecord, StorageError>;
  findById(id: SessionId): ResultAsync<SessionRecord | null, StorageError>;
  list(options?: ListSessionsOptions): ResultAsync<readonly SessionRecord[], StorageError>;
  recordFailure(failure: Failure): ResultAsync<void, StorageError>;
  listFailures(id: SessionId): ResultAsync<readonly Failure[], StorageError>;
}
