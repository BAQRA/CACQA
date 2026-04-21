import { type BoundingBox } from '../domain/geometry.js';
import { type VisionError } from '../errors.js';
import { type ResultAsync } from '../result.js';

export interface OCRBlock {
  readonly text: string;
  readonly bounds: BoundingBox;
  readonly confidence: number;
}

export interface OCRResult {
  readonly fullText: string;
  readonly blocks: readonly OCRBlock[];
  readonly durationMs: number;
}

/**
 * Port: extracts text and structural hints from a screenshot. Implementations
 * are expected to be stateless — caller supplies the image each call.
 */
export interface VisionService {
  extractText(image: Buffer, region?: BoundingBox): ResultAsync<OCRResult, VisionError>;
  dispose(): Promise<void>;
}
