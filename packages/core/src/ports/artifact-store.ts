import { type StorageError } from '../errors.js';
import { type ResultAsync } from '../result.js';

export interface StoredArtifact {
  readonly key: string;
  readonly url: string;
  readonly contentType: string;
  readonly size: number;
}

/**
 * Port: persists screenshots, DOM snapshots, and state JSON for later replay
 * and human review. Local filesystem in dev, S3-compatible in prod.
 *
 * The `key` is a deterministic path like `sessions/<id>/rounds/<n>/before.png`
 * so failures can cite stable URLs.
 */
export interface ArtifactStore {
  put(
    key: string,
    body: Buffer,
    contentType: string,
  ): ResultAsync<StoredArtifact, StorageError>;
  get(key: string): ResultAsync<Buffer, StorageError>;
  getUrl(key: string, expiresInSeconds?: number): ResultAsync<string, StorageError>;
}
