import sharp from 'sharp';
import { createWorker, type Worker as TesseractWorker } from 'tesseract.js';
import {
  fromPromise,
  ResultAsync,
  VisionError,
  type BoundingBox,
  type Logger,
  type OCRBlock,
  type OCRResult,
  type VisionService,
} from '@cacqa/core';

export interface TesseractVisionServiceOptions {
  readonly language?: string;
  readonly logger: Logger;
}

/**
 * Tesseract.js adapter. A single Worker is created lazily and reused across
 * calls — creating a worker is expensive (~1s + model download). Callers MUST
 * call dispose() on shutdown or the worker will pin CPU and memory.
 *
 * For higher accuracy in production, swap this adapter for a PaddleOCR sidecar
 * — the VisionService port is identical.
 */
export class TesseractVisionService implements VisionService {
  private worker: TesseractWorker | null = null;
  private readonly language: string;
  private readonly log: Logger;
  private initializing: Promise<TesseractWorker> | null = null;

  public constructor(opts: TesseractVisionServiceOptions) {
    this.language = opts.language ?? 'eng';
    this.log = opts.logger.child({ service: 'tesseract-vision' });
  }

  public extractText(image: Buffer, region?: BoundingBox): ResultAsync<OCRResult, VisionError> {
    return fromPromise(this.getWorker(), (cause) =>
      new VisionError('Failed to init Tesseract worker', { cause }),
    )
      .andThen((worker) => this.preprocess(image, region).map((buf) => ({ worker, buf })))
      .andThen(({ worker, buf }) => this.recognize(worker, buf));
  }

  public async dispose(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }

  // ── private ────────────────────────────────────────────────────────────────

  private async getWorker(): Promise<TesseractWorker> {
    if (this.worker) {
      return this.worker;
    }
    this.initializing ??= (async () => {
      this.log.debug({ language: this.language }, 'Initializing Tesseract worker');
      const w = await createWorker(this.language);
      this.worker = w;
      return w;
    })();
    return this.initializing;
  }

  /**
   * Upscale + grayscale + normalize. OCR accuracy on game UI is sensitive to
   * small font sizes; the 2x upscale typically reclaims 10–15% accuracy.
   */
  private preprocess(image: Buffer, region?: BoundingBox): ResultAsync<Buffer, VisionError> {
    return fromPromise(
      (async () => {
        let pipeline = sharp(image);
        if (region) {
          pipeline = pipeline.extract({
            left: region.x,
            top: region.y,
            width: region.width,
            height: region.height,
          });
        }
        return pipeline
          .resize({ width: undefined, height: undefined, fit: 'inside' })
          .greyscale()
          .normalize()
          .sharpen()
          .toBuffer();
      })(),
      (cause) => new VisionError('Image preprocessing failed', { cause }),
    );
  }

  private recognize(worker: TesseractWorker, buf: Buffer): ResultAsync<OCRResult, VisionError> {
    const start = Date.now();
    return fromPromise(
      worker.recognize(buf, undefined, { blocks: true }),
      (cause) => new VisionError('Tesseract recognize failed', { cause }),
    ).map((raw) => {
      const durationMs = Date.now() - start;
      const fullText = raw.data.text ?? '';
      const blocks: OCRBlock[] = (raw.data.blocks ?? [])
        .filter((b) => b.bbox && typeof b.confidence === 'number')
        .map((b) => ({
          text: b.text.trim(),
          bounds: {
            x: Math.max(0, Math.floor(b.bbox.x0)),
            y: Math.max(0, Math.floor(b.bbox.y0)),
            width: Math.max(1, Math.floor(b.bbox.x1 - b.bbox.x0)),
            height: Math.max(1, Math.floor(b.bbox.y1 - b.bbox.y0)),
          },
          confidence: Math.max(0, Math.min(1, b.confidence / 100)),
        }));
      // Empty OCR is common and legitimate for Canvas/WebGL games — text lives
      // inside the canvas and isn't extractable. We return an empty result and
      // let the LLM work from the screenshot alone.
      return { fullText, blocks, durationMs } satisfies OCRResult;
    });
  }
}
