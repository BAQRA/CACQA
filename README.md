# cacqa — autonomous QA for browser-based crash & slot games

An AI-driven QA tool that opens a real browser, observes the game with vision +
OCR, generates and executes test scenarios (golden paths, edge cases, network
chaos), validates outcomes against domain rules, and reports failures with
replayable artifacts.

The base is built for: free-tier dev today, paid-tier scale tomorrow.

---

## Quick start

```bash
# 1. Tooling
nvm use                      # Node 20.11+
corepack enable
pnpm install
cp .env.example .env         # then paste your GEMINI_API_KEY

# 2. (Optional) local infra — only needed once you wire Prisma + S3.
# The worker currently uses an in-memory repo + local disk for artifacts,
# so infra:up isn't required for the MVP.
pnpm infra:up

# 3. End-to-end smoke (one session, no queue)
pnpm --filter @cacqa/worker exec tsx src/cli/run-once.ts https://your-game-url

# 4. Full stack (dev mode, all apps in parallel)
pnpm dev
```

Get a free Gemini API key at https://aistudio.google.com/apikey. Make sure the
project has **no billing attached** — free tier disappears the moment a billing
account is linked.

## What you get

| App / Package      | Purpose                                                   |
| ------------------ | --------------------------------------------------------- |
| `apps/worker`      | Pulls jobs from BullMQ, runs sessions end-to-end          |
| `apps/api`         | NestJS — schedule sessions, query results                 |
| `apps/dashboard`   | Next.js 15 — replay sessions, inspect failures (stub)     |
| `packages/core`    | Domain types, ports, Result, errors, logger               |
| `packages/browser` | Playwright adapter (touch + mouse dual-dispatch)          |
| `packages/vision`  | tesseract.js adapter for the `VisionService` port         |
| `packages/llm`     | Gemini + Mock adapters for the `LLMProvider` port         |
| `packages/oracle`  | Pure-function rule engine — observed vs expected          |
| `packages/config`  | Shared tsconfigs + zod-validated env schema               |
| `infra/`           | docker-compose for Postgres, Redis, MinIO                 |

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the design rationale, the ports &
adapters layout, vision-driven intro dismissal, semantic-to-visual click
resolution, and the path to multi-tenant SaaS.

## Common commands

```bash
pnpm build       # build all packages + apps
pnpm dev         # dev mode (turbo runs every app's dev script)
pnpm typecheck   # strict TS across the monorepo
pnpm lint        # ESLint flat config, type-aware
pnpm test        # vitest across packages
pnpm format      # prettier
```

## Configuring the LLM

`LLM_PROVIDER` in `.env` selects the adapter:

- `gemini` — default for dev. Default model is `gemini-2.5-flash-lite` (free
  tier, fast, accepts images and strict JSON). Set `GEMINI_API_KEY`.
- `claude` — production / paid customers (stub today, drop in Anthropic SDK).
- `mock` — deterministic, offline. For tests and local iteration.

Adding a new provider is one file: implement `LLMProvider` from
`@cacqa/core/ports`, register it in `packages/llm/src/factory.ts`, set the env.

## Current state (snapshot)

**Working end-to-end:**
- Scaffolding, typing (9/9 packages typecheck clean), logging, retry on 5xx
- Vision-driven state extraction (balance, round, elements, dismissHint)
- Vision-driven intro/overlay pre-flight (replaces hardcoded label dismissal)
- Scenario library + LLM scenario planner with library fallback
- Semantic → visual click resolution (so `place-bet` works on Canvas games)
- Oracle rule engine with 4 universal invariants
- Per-observation artifact persistence (`rounds/<N>/<label>.png`)
- Touch + mouse dual-dispatch on every `click-point` (Canvas-aware)

**Known gaps / next threads:**
1. Some games don't respond to synthetic touch OR mouse events — CDP
   `Input.dispatchMouseEvent` or `hover+click()` on canvas may be needed.
2. `cash-out-available-mid-round` rule is crash-game biased; fires falsely on
   slots. Needs game-category gating.
3. `InMemorySessionRepository` / `LocalArtifactStore` are stubs — Prisma + S3
   adapters unlock the dashboard and multi-tenancy.
4. Next.js dashboard is a placeholder — wire `GET /sessions` on the API.

## Contributing rules

- All cross-package contracts live in `packages/core`. New behavior = new port
  or new domain type, not a new import path between adapters.
- Adapters never throw across the boundary. Return `Result<T, AppError>`.
- New env vars go through `packages/config/src/env.ts` so they're validated at
  boot, not at first read.
- No `any`. The lint rule enforces it.
- Prefer `.optional()` / `.nullish()` over `.default()` in shared Zod schemas
  — zod's `.default()` output inference conflicts with strict TS settings.
