import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { Controller, Get, NotFoundException, Param } from '@nestjs/common';

interface RoundObservationDto {
  readonly filename: string;
  readonly label: string;
  readonly url: string; // served by ArtifactsController
}

interface RoundDto {
  readonly index: number;
  readonly observations: readonly RoundObservationDto[];
}

/**
 * Enumerates per-round screenshot artifacts saved by the worker so the
 * dashboard can render a flipbook without having to index the filesystem
 * itself. Pure disk scan — no DB hits.
 */
@Controller('sessions/:id/rounds')
export class RoundsController {
  private readonly rootDir = resolve(process.env['WORKER_ARTIFACT_DIR'] ?? './artifacts');

  @Get()
  public async list(@Param('id') sessionId: string): Promise<{ items: RoundDto[] }> {
    const sessionDir = join(this.rootDir, 'sessions', sessionId, 'rounds');
    let roundDirs: string[];
    try {
      const entries = await readdir(sessionDir, { withFileTypes: true });
      roundDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      throw new NotFoundException(`No rounds found for session ${sessionId}`);
    }

    const rounds: RoundDto[] = await Promise.all(
      roundDirs.map(async (name) => {
        const roundPath = join(sessionDir, name);
        const files = await readdir(roundPath).catch(() => []);
        const pngs = files.filter((f) => f.toLowerCase().endsWith('.png'));
        return {
          index: Number(name),
          observations: pngs.map<RoundObservationDto>((filename) => ({
            filename,
            label: filename.replace(/\.png$/i, ''),
            url: `/api/artifacts/sessions/${sessionId}/rounds/${name}/${filename}`,
          })),
        };
      }),
    );

    // Natural round order: pre-flight (negative) first, then 0 (initial), then 1..N.
    rounds.sort((a, b) => a.index - b.index);
    return { items: rounds };
  }
}
