/// <reference lib="dom" />
// `document`, `HTMLElement`, `MouseEvent`, `PointerEvent` referenced here are
// for the callbacks we hand to `page.evaluate()` — those execute in the
// browser context, not Node. Scoped to this file via the directive so we
// don't leak DOM globals into other packages.

import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from 'playwright';
import {
  BrowserError,
  errAsync,
  fromPromise,
  ResultAsync,
  type Action,
  type BrowserContextOptions,
  type BrowserDriver,
  type BrowserDriverFactory,
  type Logger,
  type NetworkProfile,
  type Point,
  type Screenshot,
} from '@cacqa/core';

interface NetworkConditionPreset {
  readonly offline: boolean;
  readonly downloadThroughput: number;
  readonly uploadThroughput: number;
  readonly latency: number;
}

const NETWORK_PRESETS: Record<Exclude<NetworkProfile, 'none'>, NetworkConditionPreset> = {
  offline: { offline: true, downloadThroughput: 0, uploadThroughput: 0, latency: 0 },
  'slow-3g': {
    offline: false,
    downloadThroughput: (500 * 1024) / 8,
    uploadThroughput: (500 * 1024) / 8,
    latency: 400,
  },
  'fast-3g': {
    offline: false,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
    latency: 150,
  },
};

/**
 * Playwright-based BrowserDriver. One instance drives one BrowserContext. The
 * factory below manages the shared Browser process to amortize launch cost
 * across concurrent sessions.
 */
export class PlaywrightBrowserDriver implements BrowserDriver {
  private readonly log: Logger;
  private cdp: CDPSession | null = null;
  private closed = false;

  public constructor(
    private readonly context: BrowserContext,
    private readonly page: Page,
    logger: Logger,
  ) {
    this.log = logger.child({ driver: 'playwright' });
  }

  public navigate(url: string): ResultAsync<void, BrowserError> {
    return fromPromise(
      this.page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 }).then(() => undefined),
      (cause) => new BrowserError(`Failed to navigate to ${url}`, { cause, context: { url } }),
    );
  }

  public screenshot(): ResultAsync<Screenshot, BrowserError> {
    return fromPromise(
      (async () => {
        const buffer = await this.page.screenshot({ type: 'png', fullPage: false });
        const viewport = this.page.viewportSize();
        return {
          buffer,
          width: viewport?.width ?? 0,
          height: viewport?.height ?? 0,
          takenAt: new Date(),
        } satisfies Screenshot;
      })(),
      (cause) => new BrowserError('Screenshot failed', { cause }),
    );
  }

  public executeAction(action: Action): ResultAsync<void, BrowserError> {
    switch (action.type) {
      case 'click-element':
        return this.clickByLabel(action.label, action.occurrence ?? 0);
      case 'click-if-present':
        return this.clickIfPresent(action.label, action.timeoutMs ?? 2_000);
      case 'click-point':
        return this.clickPoint(action.at);
      case 'set-bet':
        // Placeholder: games vary wildly here. A per-game adapter layered on
        // top of this driver should translate set-bet into concrete UI
        // interactions (type into input, click +/- buttons). We intentionally
        // do not hardcode a selector — domain doesn't know the skin.
        return errAsync(
          new BrowserError('set-bet requires a per-game action translator; not implemented here'),
        );
      case 'place-bet':
        return this.clickByLabel('place bet');
      case 'cash-out':
        return this.clickByLabel('cash out');
      case 'type-text':
        return this.typeByLabel(action.label, action.value);
      case 'wait':
        return fromPromise(
          new Promise<void>((resolve) => setTimeout(resolve, action.milliseconds)),
          (cause) => new BrowserError('Wait failed', { cause }),
        );
      case 'reload':
        return fromPromise(
          this.page.reload({ waitUntil: 'networkidle' }).then(() => undefined),
          (cause) => new BrowserError('Reload failed', { cause }),
        );
      case 'throttle-network':
        return this.setNetworkProfile(
          action.profile === 'restore' ? 'none' : action.profile,
        );
      case 'open-new-tab':
        return this.openNewTab(action.url);
    }
  }

  public clickPoint(point: Point): ResultAsync<void, BrowserError> {
    return fromPromise(
      (async () => {
        // Diagnostic: what's actually at these coordinates? Helps distinguish
        // "the click is landing on a transparent overlay" from "we're hitting
        // nothing" from "we're hitting the right canvas but the game ignores
        // untrusted events".
        const target = await this.page
          .evaluate(({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            if (!el) {
              return { tag: null, iframe: false };
            }
            return {
              tag: el.tagName.toLowerCase(),
              id: (el as HTMLElement).id || undefined,
              classes: (el as HTMLElement).className || undefined,
              iframe: el.tagName.toLowerCase() === 'iframe',
              rect: el.getBoundingClientRect(),
            };
          }, point)
          .catch(() => null);
        this.log.debug({ point, target }, 'clickPoint: element under cursor');

        // Casino games split into three input camps:
        //   - desktop-biased: mouse events
        //   - mobile-first (most modern): touchstart/pointerdown
        //   - strict trusted-event games: neither synthetic path works →
        //     we additionally dispatch via page.evaluate() on the actual
        //     element, which some engines accept.
        //
        // We fire ALL THREE; the game handles whichever it accepts.

        try {
          await this.page.touchscreen.tap(point.x, point.y);
        } catch (err) {
          this.log.debug({ err }, 'touchscreen tap unavailable; using mouse only');
        }

        await this.page.mouse.move(point.x, point.y);
        await new Promise((r) => setTimeout(r, 30));
        await this.page.mouse.down();
        await new Promise((r) => setTimeout(r, 80));
        await this.page.mouse.up();
        await new Promise((r) => setTimeout(r, 100));

        // DOM-targeted click — dispatches mousedown/mouseup/click + pointer
        // events directly on the element at the coordinate. Works for games
        // that listen on the canvas element specifically rather than window.
        try {
          await this.page.evaluate(({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            if (!el) {
              return;
            }
            const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 } as const;
            el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'touch' }));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'touch' }));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
          }, point);
        } catch (err) {
          this.log.debug({ err }, 'DOM dispatch fallback failed; continuing');
        }

        await new Promise((r) => setTimeout(r, 150));
      })(),
      (cause) => new BrowserError('clickPoint failed', { cause, context: { point } }),
    );
  }

  public setNetworkProfile(profile: NetworkProfile): ResultAsync<void, BrowserError> {
    return fromPromise(
      (async () => {
        const cdp = await this.ensureCdp();
        if (profile === 'none') {
          await cdp.send('Network.emulateNetworkConditions', {
            offline: false,
            downloadThroughput: -1,
            uploadThroughput: -1,
            latency: 0,
          });
          return;
        }
        const preset = NETWORK_PRESETS[profile];
        await cdp.send('Network.emulateNetworkConditions', preset);
      })(),
      (cause) => new BrowserError('Failed to set network profile', { cause, context: { profile } }),
    );
  }

  public openNewTab(url: string): ResultAsync<void, BrowserError> {
    return fromPromise(
      (async () => {
        const newPage = await this.context.newPage();
        await newPage.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      })(),
      (cause) => new BrowserError(`Failed to open new tab at ${url}`, { cause, context: { url } }),
    );
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      await this.context.close();
    } catch (err) {
      this.log.warn({ err }, 'Error closing Playwright context');
    }
  }

  // ── private ────────────────────────────────────────────────────────────────

  private async ensureCdp(): Promise<CDPSession> {
    this.cdp ??= await this.context.newCDPSession(this.page);
    return this.cdp;
  }

  /**
   * Clicks an element by its visible accessibility name. We prefer ARIA over
   * CSS selectors because game UIs reshuffle DOM frequently, and ARIA names
   * tend to stay stable across skins.
   */
  private clickByLabel(label: string, occurrence = 0): ResultAsync<void, BrowserError> {
    return fromPromise(
      (async () => {
        const locator = this.page.getByRole('button', { name: new RegExp(label, 'i') }).nth(occurrence);
        await locator.click({ timeout: 5_000 });
      })(),
      (cause) =>
        new BrowserError(`Click by label failed: ${label}`, {
          cause,
          context: { label, occurrence },
        }),
    );
  }

  /**
   * Best-effort click. Never fails the scenario — if the element isn't there,
   * we log and move on. Used to dismiss tutorials, modals, cookie banners.
   */
  private clickIfPresent(label: string, timeoutMs: number): ResultAsync<void, BrowserError> {
    return fromPromise(
      (async () => {
        const pattern = new RegExp(label, 'i');
        // Try as a button first, fall back to any clickable text/link.
        const candidates = [
          this.page.getByRole('button', { name: pattern }).first(),
          this.page.getByRole('link', { name: pattern }).first(),
          this.page.getByText(pattern).first(),
        ];
        for (const locator of candidates) {
          try {
            await locator.waitFor({ state: 'visible', timeout: timeoutMs });
            await locator.click({ timeout: timeoutMs });
            this.log.debug({ label }, 'dismissed element via click-if-present');
            return;
          } catch {
            // try next candidate
          }
        }
        this.log.debug({ label }, 'click-if-present: no matching element, continuing');
      })(),
      // This promise never rejects in practice (we swallow inside), but the
      // signature stays consistent with other actions.
      (cause) => new BrowserError(`click-if-present failed unexpectedly: ${label}`, { cause }),
    );
  }

  private typeByLabel(label: string, value: string): ResultAsync<void, BrowserError> {
    return fromPromise(
      (async () => {
        const locator = this.page.getByLabel(new RegExp(label, 'i')).first();
        await locator.fill(value, { timeout: 5_000 });
      })(),
      (cause) =>
        new BrowserError(`Type by label failed: ${label}`, {
          cause,
          context: { label, value },
        }),
    );
  }
}

/**
 * Factory that owns the shared Browser process. A single process hosts many
 * independent BrowserContexts; this is dramatically cheaper than launching
 * Chromium per session and is the standard scaling pattern.
 */
export class PlaywrightBrowserDriverFactory implements BrowserDriverFactory {
  private browserPromise: Promise<Browser> | null = null;

  public constructor(
    private readonly logger: Logger,
    private readonly launchHeadless: boolean,
  ) {}

  public async create(options: BrowserContextOptions): Promise<BrowserDriver> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: options.viewport,
      // hasTouch enables page.touchscreen.tap(), required by many casino games
      // that listen for touch/pointer events and ignore plain mouse events.
      // deviceScaleFactor: 1 keeps screenshot pixel coords 1:1 with click coords,
      // avoiding surprises on Retina hosts.
      hasTouch: true,
      deviceScaleFactor: 1,
      ...(options.userAgent !== undefined && { userAgent: options.userAgent }),
      ...(options.locale !== undefined && { locale: options.locale }),
      ...(options.timezone !== undefined && { timezoneId: options.timezone }),
    });
    const page = await context.newPage();
    return new PlaywrightBrowserDriver(context, page, this.logger);
  }

  public async shutdown(): Promise<void> {
    if (!this.browserPromise) {
      return;
    }
    const browser = await this.browserPromise;
    this.browserPromise = null;
    await browser.close();
  }

  private getBrowser(): Promise<Browser> {
    this.browserPromise ??= chromium.launch({
      headless: this.launchHeadless,
      args: ['--disable-blink-features=AutomationControlled'],
      // In headful mode, slow actions to a human-observable pace so a dev
      // can watch what the agent is doing and click manually if needed.
      ...(this.launchHeadless ? {} : { slowMo: 150 }),
    });
    return this.browserPromise;
  }
}
