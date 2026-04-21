import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';

import { Controller, Get, NotFoundException, Param, StreamableFile } from '@nestjs/common';

@Controller('artifacts')
export class ScreenshotsController {
  private readonly rootDir = resolve(process.env['WORKER_ARTIFACT_DIR'] ?? './artifacts');

  @Get('sessions/:sessionId/rounds/:round/:filename')
  public async stream(
    @Param('sessionId') sessionId: string,
    @Param('round') round: string,
    @Param('filename') filename: string,
  ): Promise<StreamableFile> {
    if (!/\.(png|jpe?g|webp)$/i.test(filename)) {
      throw new NotFoundException('Unsupported artifact type');
    }
    const fullPath = resolve(
      normalize(join(this.rootDir, 'sessions', sessionId, 'rounds', round, filename)),
    );
    if (!fullPath.startsWith(this.rootDir + sep)) {
      throw new NotFoundException('Artifact path escapes root');
    }
    const s = await stat(fullPath).catch(() => null);
    if (!s || !s.isFile()) {
      throw new NotFoundException(`Artifact not found: ${filename}`);
    }
    return new StreamableFile(createReadStream(fullPath), {
      type: contentType(filename),
      length: s.size,
    });
  }
}

function contentType(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'png') {
    return 'image/png';
  }
  if (ext === 'jpg' || ext === 'jpeg') {
    return 'image/jpeg';
  }
  if (ext === 'webp') {
    return 'image/webp';
  }
  return 'application/octet-stream';
}
