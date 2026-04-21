import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  okAsync,
  ResultAsync,
  StorageError,
  type ArtifactStore,
  type Logger,
  type StoredArtifact,
} from '@cacqa/core';

export interface LocalArtifactStoreOptions {
  readonly rootDir: string;
  readonly logger: Logger;
}

/**
 * Filesystem-backed ArtifactStore for development. Keys are interpreted as
 * relative paths under `rootDir`. URLs are file:// — fine for the local
 * dashboard; in prod we swap for an S3 adapter that returns presigned URLs.
 */
export class LocalArtifactStore implements ArtifactStore {
  private readonly rootDir: string;
  private readonly log: Logger;

  public constructor(opts: LocalArtifactStoreOptions) {
    this.rootDir = resolve(opts.rootDir);
    this.log = opts.logger.child({ store: 'local-artifact' });
  }

  public put(key: string, body: Buffer, contentType: string): ResultAsync<StoredArtifact, StorageError> {
    const fullPath = join(this.rootDir, key);
    return ResultAsync.fromPromise(
      (async () => {
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, body);
        return {
          key,
          url: `file://${fullPath}`,
          contentType,
          size: body.byteLength,
        } satisfies StoredArtifact;
      })(),
      (cause) => new StorageError(`Failed to write artifact ${key}`, { cause, context: { key } }),
    );
  }

  public get(key: string): ResultAsync<Buffer, StorageError> {
    const fullPath = join(this.rootDir, key);
    return ResultAsync.fromPromise(
      readFile(fullPath),
      (cause) => new StorageError(`Failed to read artifact ${key}`, { cause, context: { key } }),
    );
  }

  public getUrl(key: string): ResultAsync<string, StorageError> {
    return okAsync(`file://${join(this.rootDir, key)}`);
  }
}
