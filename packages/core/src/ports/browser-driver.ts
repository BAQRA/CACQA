import { type BrowserError } from '../errors.js';
import { type ResultAsync } from '../result.js';
import { type Action } from '../domain/action.js';
import { type Point } from '../domain/geometry.js';
import { type NetworkProfile } from '../domain/session.js';

export interface BrowserContextOptions {
  readonly viewport: { width: number; height: number };
  readonly userAgent?: string;
  readonly locale?: string;
  readonly timezone?: string;
}

export interface Screenshot {
  readonly buffer: Buffer;
  readonly width: number;
  readonly height: number;
  readonly takenAt: Date;
}

/**
 * Port: controls a browser session. The adapter decides the engine (Playwright
 * today, Puppeteer or CDP tomorrow). Implementations MUST:
 *   - be safe to call concurrently across different instances
 *   - never leak browser processes (close() is idempotent)
 *   - translate underlying errors into BrowserError with useful context
 */
export interface BrowserDriver {
  navigate(url: string): ResultAsync<void, BrowserError>;
  screenshot(): ResultAsync<Screenshot, BrowserError>;
  executeAction(action: Action): ResultAsync<void, BrowserError>;
  clickPoint(point: Point): ResultAsync<void, BrowserError>;
  setNetworkProfile(profile: NetworkProfile): ResultAsync<void, BrowserError>;
  openNewTab(url: string): ResultAsync<void, BrowserError>;
  close(): Promise<void>;
}

export interface BrowserDriverFactory {
  create(options: BrowserContextOptions): Promise<BrowserDriver>;
}
