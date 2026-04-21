# cacqa — autonomous QA for browser-based crash & slot games

An AI-driven QA tool that opens a real browser, observes the game with vision +
OCR, generates and executes test scenarios (golden paths, edge cases, network
chaos), validates outcomes against domain rules, and reports failures with
replayable artifacts.

The base is built for: free-tier dev today, paid-tier scale tomorrow.

---

## First-time setup

```bash
# 1. Tooling
nvm use                      # Node 20.11+
corepack enable
pnpm install                 # installs deps + Playwright Chromium (~1 min)

# 2. Environment
cp .env.example .env
# Then edit .env and set:
#   GEMINI_API_KEY=...  (free key at https://aistudio.google.com/apikey)
#   WORKER_ARTIFACT_DIR=/absolute/path/to/cacqa/artifacts  (must be absolute!)
```

Get a free Gemini API key at https://aistudio.google.com/apikey. Make sure the
project has **no billing attached** — free tier disappears the moment a billing
account is linked.

## Daily dev — how to start the project

Two terminals. Leave both running.

**Terminal 1 — API** (spawns the worker when a session is submitted, serves data
to the dashboard):
```bash
pnpm --filter @cacqa/api dev
```
Listens on **http://localhost:3001**.

**Terminal 2 — Dashboard** (the browser UI):
```bash
pnpm --filter @cacqa/dashboard dev
```
Listens on **http://localhost:3002**.

Then open **[http://localhost:3002](http://localhost:3002)**, paste a game URL
into the form, click **Run test**. The dashboard navigates to the session detail
page and auto-refreshes screenshots + status every 3 seconds until the run
finishes.

**To stop:** `Ctrl+C` in each terminal. If ports stay occupied:
```bash
lsof -ti :3001 | xargs kill -9
lsof -ti :3002 | xargs kill -9
pkill -9 -f "apps/(api|worker|dashboard)"
```

### Running a session directly (no dashboard)

For debugging prompts / scenarios / rules in isolation:
```bash
pnpm --filter @cacqa/worker exec tsx src/cli/run-once.ts https://your-game-url
```
Headful + observe manually:
```bash
WORKER_HEADLESS=false WORKER_HOLD_OPEN_MS=45000 \
  pnpm --filter @cacqa/worker exec tsx src/cli/run-once.ts https://your-game-url
```

### (Optional) docker infra

Not required today — sessions persist to the local filesystem. Reserved for when
Prisma + S3 adapters land:
```bash
pnpm infra:up     # Postgres + Redis + MinIO
pnpm infra:down
```

## What you get

| App / Package      | Purpose                                                        |
| ------------------ | -------------------------------------------------------------- |
| `apps/api`         | NestJS on :3001 — POST /sessions spawns worker, GET endpoints for dashboard |
| `apps/worker`      | Session runner — Playwright + vision + oracle, writes to filesystem repo   |
| `apps/dashboard`   | Next.js 15 on :3002 — URL form, session list, auto-refreshing detail page  |
| `packages/core`    | Domain types, ports, Result, errors, logger                    |
| `packages/browser` | Playwright adapter (touch + mouse + DOM dispatch)              |
| `packages/vision`  | tesseract.js adapter for the `VisionService` port              |
| `packages/llm`     | Gemini + Mock adapters for the `LLMProvider` port              |
| `packages/oracle`  | Pure-function rule engine — observed vs expected               |
| `packages/storage` | `FilesystemSessionRepository` (Prisma-ready port)              |
| `packages/config`  | Shared tsconfigs + zod-validated env schema                    |
| `infra/`           | docker-compose for Postgres, Redis, MinIO (not needed today)   |

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the design rationale, the ports &
adapters layout, vision-driven intro dismissal, semantic-to-visual click
resolution, and the path to multi-tenant SaaS.

See [CLAUDE.md](./CLAUDE.md) for conventions, gotchas, and everything an AI
assistant (or a new contributor) needs to be productive in the codebase.

## Common commands

```bash
pnpm build       # build all packages + apps
pnpm dev         # dev mode (turbo runs every app's dev script — rarely what you want)
pnpm typecheck   # strict TS across the monorepo
pnpm lint        # ESLint flat config, type-aware
pnpm test        # vitest across packages
pnpm format      # prettier

# Per-package
pnpm --filter @cacqa/core test
pnpm --filter @cacqa/oracle test
```

## Configuring the LLM

`LLM_PROVIDER` in `.env` selects the adapter:

- `gemini` — default for dev. Default model is `gemini-2.5-flash-lite` (free
  tier, fast, accepts images and strict JSON). Set `GEMINI_API_KEY`.
- `claude` — production / paid customers (stub today, drop in Anthropic SDK).
- `mock` — deterministic, offline. For tests and local iteration.

Adding a new provider is one file: implement `LLMProvider` from
`@cacqa/core/ports`, register it in `packages/llm/src/factory.ts`, set the env.

Free-tier Gemini caps at **20 requests/day** on `gemini-2.5-flash-lite` per
project. Hit that ceiling quickly? Either wait until midnight Pacific, create a
key in a fresh Google project, or enable billing (pennies per session).

## Current state (snapshot)

**Working end-to-end:**
- 10/10 packages typecheck clean
- Browser UI → API → spawned worker → filesystem repo → API → dashboard
  auto-refresh (no Redis, no queue needed for MVP)
- Vision-driven state extraction (balance, round, elements, dismissHint)
- Vision-driven intro/overlay pre-flight (per-game adaptive, no hardcoded labels)
- Scenario library + LLM scenario planner with library fallback
- Semantic → visual click resolution (so `place-bet` works on Canvas games)
- Oracle rule engine with 4 universal invariants
- Per-observation artifact persistence (`rounds/<N>/<label>.png`)
- Touch + mouse + DOM-dispatch triple-strategy click (Canvas-aware)
- Retry with backoff on 5xx LLM errors; terminal session status on every exit path

**Known gaps / next threads:**
1. Some games refuse synthetic events entirely — CDP `Input.dispatchMouseEvent`
   with trust flags may be the next step.
2. `cash-out-available-mid-round` rule is crash-game biased; fires falsely on
   slots. Needs game-category gating.
3. `FilesystemSessionRepository` is fine for single-machine dev. Swap for
   Prisma + Postgres when multi-tenant, multi-machine becomes real.
4. Dashboard shows sessions + failures + screenshot timeline. Could add:
   failure filtering, bulk replay, rule-violation heatmap, per-game config UI.

## Contributing rules

- All cross-package contracts live in `packages/core`. New behavior = new port
  or new domain type, not a new import path between adapters.
- Adapters never throw across the boundary. Return `Result<T, AppError>`.
- New env vars go through `packages/config/src/env.ts` so they're validated at
  boot, not at first read.
- No `any`. The lint rule enforces it.
- Prefer `.optional()` / `.nullish()` over `.default()` in shared Zod schemas
  — zod's `.default()` output inference conflicts with strict TS settings.
