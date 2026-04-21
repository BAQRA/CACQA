# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Autonomous QA for browser-based crash/slot casino games. A worker opens the game in Chromium, captures screenshots, uses Gemini (vision) + tesseract OCR to extract structured state, runs deterministic and LLM-generated scenarios against the game, and checks invariants with a pure-function rule engine. Target: free to run during dev, paid-tier scale later. Full rationale in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Common commands

```bash
pnpm install              # installs deps + Playwright Chromium
pnpm typecheck            # strict TS across all 10 packages
pnpm test                 # vitest; some packages have no tests and use --passWithNoTests
pnpm lint                 # ESLint flat config, type-aware
pnpm build                # turbo build

# Run a single package's tests
pnpm --filter @cacqa/core test
pnpm --filter @cacqa/oracle test

# Daily dev: two terminals
pnpm --filter @cacqa/api dev         # API on :3001 (also spawns worker on demand)
pnpm --filter @cacqa/dashboard dev   # Next.js on :3002 — paste URL + run
# Then open http://localhost:3002

# Run ONE session from the CLI (bypasses dashboard, useful for debugging prompts)
pnpm --filter @cacqa/worker exec tsx src/cli/run-once.ts https://your-game-url

# Infra stack (NOT yet required — repo uses filesystem storage; reserve for Prisma+S3 migration)
pnpm infra:up / pnpm infra:down      # Postgres + Redis + MinIO via docker-compose
```

Node 20.11+, pnpm 9.1.0 pinned. Session data is persisted under `artifacts/sessions/<id>/`:
- `session.json` — the SessionRecord (written by worker, read by API)
- `failures.json` — rule violations accumulated during the run
- `worker.log` — full stdout/stderr of the spawned worker process (only created when launched via API)
- `rounds/<n>/<label>.png` — per-observation screenshots (`initial`, `after-dismiss`, `action-0-after-place-bet`, …)

## Running sessions from the dashboard

The dashboard has a URL input at the top. Submitting it POSTs to `/api/sessions`, which:

1. Generates a `sessionId` and `organizationId`
2. Writes an initial session record (so the dashboard can see it immediately)
3. **Spawns the worker as a detached subprocess** (`pnpm exec tsx src/cli/run-once.ts <url>`) with `CACQA_SESSION_ID` and `CACQA_ORGANIZATION_ID` as env vars
4. Returns the sessionId so the dashboard navigates straight to the detail page

The detail page auto-refreshes every 3 seconds while `status === 'queued' | 'running'` (see `auto-refresh.tsx`). No queue, no Redis, no polling-overhead past that interval.

See [apps/api/src/sessions/sessions.service.ts](apps/api/src/sessions/sessions.service.ts) for the spawn logic. The subprocess output is piped to `artifacts/sessions/<id>/worker.log` — if a session ever looks stuck, `tail` that file.

## LLM + env

`.env` at repo root (not committed). `LLM_PROVIDER` swaps implementations:

- `gemini` (default) → `gemini-2.5-flash-lite`. **Do not use `gemini-2.0-flash`** — Google restricted its free-tier quota (limit: 0). Get keys at https://aistudio.google.com/apikey; make sure the Google Cloud project has NO billing attached or the free tier disappears.
- `mock` → offline, deterministic. Use for tests/CI.
- `claude` → stub that throws `ConfigError` until `@anthropic-ai/sdk` is wired.

Env is validated at boot via `packages/config/src/env.ts` — add new vars there, don't read `process.env` directly.

**`WORKER_ARTIFACT_DIR` must be an absolute path.** The API and worker have different CWDs (`apps/api` vs `apps/worker`), so a relative `./artifacts` resolves to two different dirs. `.env` pins it to `/abs/path/cacqa/artifacts`. If you add a new process that reads artifacts, point it there too.

**`WORKER_HEADLESS=false` + `WORKER_HOLD_OPEN_MS=45000`** is the debugging combo: a visible Chromium window stays open for 45s after the scenario so you can interact manually, open DevTools, and compare user clicks vs the automation's clicks.

## Architecture — the non-obvious parts

**Hexagonal / ports & adapters.** `packages/core` defines the domain + port interfaces and depends on nothing outside `zod`, `pino`, `neverthrow`. Adapters (`@cacqa/browser`, `@cacqa/vision`, `@cacqa/llm`, `@cacqa/oracle`, `@cacqa/storage`) implement ports. Apps wire them in a composition root — the ONLY place concrete classes are named. Start at [apps/worker/src/composition.ts](apps/worker/src/composition.ts) to understand what gets instantiated.

**Shared persistence across processes:** `@cacqa/storage` exports `FilesystemSessionRepository`. BOTH the worker (single writer) and API (reader) construct one pointing at `WORKER_ARTIFACT_DIR`. Atomic file rewrites make this safe without locks. When swapping to Prisma, replace the provider and every consumer is unchanged — the port contract is in [packages/core/src/ports/session-repository.ts](packages/core/src/ports/session-repository.ts).

**Four architectural patterns that aren't obvious from the file tree:**

### 1. Vision-driven pre-flight overlay dismissal

Every casino game opens with a blocking overlay (intro / tutorial / cookie / "click anywhere"). Instead of hardcoded label lists, the vision LLM returns a `dismissHint: { at: {x, y}, reason } | null` on every state extraction. `SessionRunner.dismissOverlays` loops observe → click hint → re-observe up to 3 times before running any scenario. Logic: [apps/worker/src/session/session-runner.ts](apps/worker/src/session/session-runner.ts). The intro-recognition signals baked into the prompt live in [packages/llm/src/prompts.ts](packages/llm/src/prompts.ts) — don't reinvent these heuristics; extend them.

### 2. Semantic vs. executed actions (`resolveAction`)

Scenarios declare SEMANTIC actions (`place-bet`, `cash-out`). Before the browser dispatches, [apps/worker/src/session/scenario-runner.ts](apps/worker/src/session/scenario-runner.ts) calls `resolveAction(rawAction, currentState, log)` which looks up likely labels (`spin`, `bet`, `play`, …) against the `elements[]` the vision LLM extracted, and swaps in a `click-point` with the element's center. **Only interactive element kinds** (button/checkbox/toggle/slider/link/icon) are eligible for semantic money actions — otherwise we'd click decorative banners with matching substrings. **The oracle receives the RAW semantic action**, not the executed click — that's what keeps rule predicates like `action.type === 'place-bet'` working across DOM and Canvas games. Preserve this separation when touching that file.

### 3. Terminal status via single `finally` block

`SessionRunner.run()` has multiple early-return paths (nav failure, initial-observation failure, etc.). Every one of those used to leave sessions stuck at `status: 'running'` forever on the dashboard. The fix: a `completedCleanly` flag plus a `finally` block that writes the terminal status (`completed` or `failed`) on every exit path, including thrown errors. **Do not write `updateStatus` elsewhere in that method** — the finally block owns it. When you add new exit paths, just flip `completedCleanly = false` before returning.

### 4. DI requires explicit `@Inject()` in the API

tsx/esbuild does NOT emit decorator metadata, so NestJS can't resolve class-type constructor injections automatically. Every provider used in an API controller/service constructor must be wired with an explicit `@Inject(TOKEN)`. Class-type providers still need `@Inject(ClassName)`. If you see `Cannot read properties of undefined (reading 'someMethod')` at request time, it's almost always a missing `@Inject`.

## Clicking on Canvas games

Many games (Pragmatic, EGT, most modern HTML5) ignore `page.mouse.click()` because they listen for pointer/touch events. `PlaywrightBrowserDriver.clickPoint` dispatches **three strategies in order**:

1. `page.touchscreen.tap()` — wakes touch/pointer handlers (context has `hasTouch: true`)
2. `mouse.move → down → 80ms hold → up` — wakes mouse handlers
3. `page.evaluate()` + `document.elementFromPoint(x,y).dispatchEvent(...)` — canvas-targeted DOM dispatch for games that listen on the canvas element specifically

Every click is also logged with `clickPoint: element under cursor` showing which DOM element was hit (`canvas`, `iframe`, etc.) so you can diagnose why a click did nothing. `deviceScaleFactor: 1` on the context keeps screenshot pixel coords 1:1 with click coords. Known gap: some games still refuse synthetic events — CDP `Input.dispatchMouseEvent` with trust flags may be the next step for those.

## Working with Zod schemas

Prefer `.optional()` or `.nullish()` over `.default()` in schemas shared across package boundaries. Zod's `.default()` output-type inference conflicts with strict TS settings (`exactOptionalPropertyTypes: true`) and silently produces `T | undefined` where you expected `T`. Applying defaults at the adapter boundary is the convention — see how [packages/llm/src/gemini-provider.ts](packages/llm/src/gemini-provider.ts) handles `ExtractStateResponse`. `UIElementSchema.kind` uses `.catch('unknown')` so novel widget types from the LLM don't reject the whole response; `RoundInfoSchema` uses `.nullish()` because LLMs emit explicit `null` even when told to omit.

## Conventions

- **Errors:** adapters return `ResultAsync<T, AppError>` from `neverthrow`. Throwing is reserved for invariant violations. `AppError` subclasses are tagged with `.kind`; pattern-match on that instead of `instanceof`.
- **IDs:** branded types (`SessionId`, `OrganizationId`, `RoundId`, …) in [packages/core/src/domain/identifiers.ts](packages/core/src/domain/identifiers.ts). The brand is a phantom property; don't try to assign to it at runtime.
- **Money:** integer in smallest currency unit, never float. `mulMoney` rounds half-away-from-zero.
- **Logging:** structured pino, child loggers carry correlation ids `{ sessionId, roundIndex, scenarioId }`. Keep that convention when adding new log sites.
- **Validation at boundaries:** env, request bodies, LLM responses. Invalid LLM output wraps into an `LLMError` with the raw JSON preserved (see `gemini-provider.ts`).
- **Empty OCR is non-fatal** — Canvas games have no extractable text; the LLM works from the raw screenshot.
- **Per-observation artifact labels** — when calling `StateObserver.observe`, pass a `label` like `'initial'`, `'after-dismiss'`, or `'action-0-after-place-bet'`. Without it, intra-round screenshots overwrite each other. See existing call sites in session-runner and scenario-runner.

## Rules the oracle enforces today

In [packages/oracle/src/rules/](packages/oracle/src/rules/):

- `balance-stable-without-money-action` — balance can't change without a bet/cash-out
- `balance-decreases-on-bet` — balance never increases after `place-bet`
- `payout-matches-multiplier` — `payout === bet * multiplier` within 1-unit tolerance when all three are observable
- `cash-out-available-mid-round` — **crash-game biased; produces false positives on slot games**. Gate on game category / per-game rule pack when that layer lands.

Rules are pure `(context) => violations[]` — no I/O, no hidden state. Add new ones by exporting from `packages/oracle/src/rules/*` and registering in `rule-engine.ts`'s `DEFAULT_RULES` array.

## What's stubbed

| Stub                               | Replace with                          |
| ---------------------------------- | ------------------------------------- |
| `FilesystemSessionRepository`      | Prisma/Postgres adapter + migration   |
| `LocalArtifactStore`               | S3 adapter (`@aws-sdk/client-s3`)     |
| Spawn-per-session in API           | BullMQ worker pool + Redis            |
| Claude provider (`factory.ts`)     | Wire `@anthropic-ai/sdk`              |
| `cash-out-available-mid-round` rule| Gate on game category / rule pack     |

All stubs honor real ports — swapping is mechanical, no domain changes.

## Gotchas

- **API `tsconfig.json` is inlined — do not re-extend `@cacqa/config/tsconfig/node`.** tsx follows pnpm symlinks and can't resolve the `../../../tsconfig.base.json` chain through the virtual store. This cost ~45 minutes of debugging once; don't rediscover it.
- **`"packageManager": "pnpm@9.1.0"`** is pinned in `package.json`. A mismatched host pnpm triggers `ERR_PNPM_BAD_PM_VERSION` — update the pin or set `COREPACK_ENABLE_STRICT=0`.
- **TypeScript project `references` were deliberately removed** from adapter tsconfigs; packages resolve each other via `main: "./src/index.ts"` source-first (faster typecheck, no pre-build step). Don't re-add `references` — it conflicts with this resolution mode.
- **`tsBuildInfoFile` MUST NOT live in the shared `library.json` template** — TS resolves it relative to the template file, causing multi-package path collisions. Each package derives its own from `outDir`.
- **Gemini quota:** free tier is 20 requests/day on `gemini-2.5-flash-lite` per project. 5xx "overloaded" errors are retried with backoff; 429 quota errors are NOT retried (they're authoritative, and retrying burns more quota). Enable billing on the Google Cloud project to lift the cap — costs pennies per session at our usage.
- **Playwright screenshots default to `scale: 'device'`**, but we set `deviceScaleFactor: 1` on the context so 1440×900 viewport → 1440×900 PNG. If you see mismatched click coordinates, check that.
- **Dashboard is on `:3002`, not `:3000`** — port 3000 often clashes with other Next.js projects. Keep `API_CORS_ORIGIN` in `.env` aligned if you change it.
- **`.ts` files with non-ASCII characters + decorators + tsx watch** have caused spurious "experimental decorators" errors in the past. If you get unexplained transform failures on a specific file, check `file <path>` — non-ASCII + decorators was once the culprit, though the real fix was inlining the API tsconfig.
- **Stopping dev cleanly:** `lsof -ti :3001 | xargs kill -9`, `lsof -ti :3002 | xargs kill -9`, and `pkill -9 -f "apps/(api|worker|dashboard)"`. `Ctrl+C` alone sometimes leaves zombie tsx/pnpm processes behind.
