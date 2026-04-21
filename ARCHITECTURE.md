# Architecture

## Goals (in order)

1. **Free to run during development.** Every default — Gemini 2.5 Flash-Lite,
   tesseract.js, local MinIO, headless Chromium — has a $0 path.
2. **Path to a paid product without a rewrite.** Every external dependency
   (LLM, OCR, browser, storage, queue, DB) sits behind a port in
   `packages/core/src/ports`. Swapping an adapter = one file + a config flag.
3. **Horizontally scalable.** Workers are stateless; a session is a queue
   message. Going from 1 worker on a laptop to 100 in Kubernetes is the same
   binary with a different concurrency setting.
4. **Senior-readable.** Hexagonal layering, tagged errors, branded IDs, Zod
   at every boundary. A new contributor can answer "where does X come from"
   by reading one composition root.

## Hexagonal layout

```
      ┌────────────────── DRIVING SIDE (entry points) ──────────────────┐
      │   apps/api (NestJS)         apps/worker (BullMQ)                │
      │        │                          │                             │
      │        │ enqueues SessionSpec     │ pulls SessionSpec           │
      │        ▼                          ▼                             │
      └─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                  ┌──────────────────────────┐
                  │  packages/core (DOMAIN)  │
                  │   • types: Money, GameState (+ DismissHint),
                  │     Scenario, Failure, Action (discriminated union)
                  │   • ports: BrowserDriver, VisionService,
                  │     LLMProvider, Oracle, ArtifactStore,
                  │     SessionRepository
                  │   • Result<T, AppError>, Logger
                  └──────────────────────────┘
                                ▲
                                │ implements
      ┌──────────────────── DRIVEN SIDE (adapters) ────────────────────┐
      │  @cacqa/browser   →  Playwright (touch + mouse, hasTouch=true) │
      │  @cacqa/vision    →  tesseract.js (+ sharp preprocessing)      │
      │  @cacqa/llm       →  Gemini (2.5 Flash-Lite default), Mock,    │
      │                      Claude (stub slot, ConfigError until SDK) │
      │  @cacqa/oracle    →  Pure-function rule engine                 │
      │  apps/worker/infra →  Local FS artifact store, in-mem repo     │
      └────────────────────────────────────────────────────────────────┘
```

The core package depends on **nothing** outside `zod`, `pino`, `neverthrow`. No
adapter ever imports another adapter. All wiring happens in apps' composition
roots (e.g. `apps/worker/src/composition.ts`).

## Session execution model

```
┌─ Queue ─┐    ┌─ Worker ───────────────────────────────────────────────┐
│  job(   │───▶│ buildContainer()                                       │
│  spec)  │    │ ▼                                                      │
└─────────┘    │ SessionRunner.run(spec)                                │
               │   ├─ navigate                                           │
               │   ├─ initial observe (screenshot → OCR → LLM state)     │
               │   ├─ pre-flight dismissOverlays() loop  ◀── new         │
               │   │     observe → if dismissHint → clickPoint → repeat  │
               │   │     up to 3 attempts, stops when LLM reports        │
               │   │     playable state (dismissHint = null)             │
               │   └─ for each round up to maxRounds:                    │
               │      ├─ ScenarioPlanner.nextScenario()                  │
               │      │     library first, then LLM-generated            │
               │      └─ ScenarioRunner.run()                            │
               │         └─ for each action:                             │
               │            ├─ resolveAction(raw, currentState)          │
               │            │    semantic → visual click translation     │
               │            ├─ browser.executeAction(resolved)           │
               │            ├─ observer.observe(label='action-N-…')      │
               │            └─ oracle.evaluate({ action: raw, ... })     │
               │                                                         │
               │ Persist: per-observation artifacts + failures           │
               └────────────────────────────────────────────────────────┘
```

**Why observe before AND after every action?** Pinpointing which action caused
a divergence is what lets the dashboard show "this click broke the balance",
not "something between scenario start and end broke the balance".

## Intro / overlay dismissal (vision-driven pre-flight)

Every browser casino game ships with a blocking overlay before gameplay is
reachable — intro splash, tutorial panel, cookie banner, "click anywhere to
continue" prompt. Patterns vary by provider (Pragmatic uses the spin button
itself as the dismiss; Smartsoft uses Play / Start; many others use a close X
or center-of-screen tap).

**Approach:** let the vision LLM classify and target, not a hardcoded label
list. The state-extraction response carries a nullable field:

```ts
dismissHint: { at: { x, y }, reason: string } | null
```

- `null` → the game is in a playable state. Proceed with scenarios.
- non-null → click `hint.at`, wait ~1.2s for animation, re-observe, repeat.

`SessionRunner.dismissOverlays` caps at 3 attempts as a failsafe. Strong intro
signals baked into the prompt (see `packages/llm/src/prompts.ts`):

1. `"don't show next time"` checkbox almost always implies an intro.
2. Fullscreen intros hide the game UI entirely — no balance, no bet controls.
3. Non-fullscreen intros leave the game board visible behind a modal.

The dismiss click goes to the play/spin/close control, **not** the checkbox —
ticking the checkbox alone rarely dismisses the overlay.

## Semantic vs. executed actions (resolveAction)

Casino games split into two rendering camps:

- **DOM-accessible** (cookie banners, older HTML5): ARIA `getByRole('button')`
  works. `page.getByLabel(...)`.
- **Canvas/WebGL** (Pragmatic, EGT, most modern): only pixels exist, ARIA
  finds nothing. We MUST click coordinates.

`ScenarioRunner.resolveAction(raw, state)` bridges this:

1. A scenario declares a **semantic** action: `place-bet`, `cash-out`,
   `click-element`, `click-if-present`.
2. Before dispatch, the runner looks up likely labels for that action (e.g.
   `place-bet` tries `spin`, `place bet`, `bet`, `play`, `start`) against the
   `elements[]` that the vision LLM extracted from the current screenshot.
3. First match wins; the runner swaps a `click-point` with the element's
   center coordinates in for the physical dispatch.
4. If no match → falls through to ARIA (still works on DOM-native games).

**Critical detail:** the **raw semantic action** is what the oracle sees. The
executed click is only what the browser gets. That separation keeps rule
predicates like `action.type === 'place-bet'` firing regardless of whether we
physically clicked a DOM button or a Canvas pixel.

## Canvas-aware clicking

`page.mouse.click()` fires mouse events. Many mobile-first casino games listen
for pointer/touch events and silently ignore mouse. `PlaywrightBrowserDriver.
clickPoint` dispatches **both**:

1. `page.touchscreen.tap(x, y)` — handles touchstart/pointerdown listeners.
2. `mouse.move → down → 80ms hold → up` — handles mousedown/click listeners.

The game handles whichever it listens for; the other is dropped harmlessly.
`hasTouch: true` and `deviceScaleFactor: 1` are set on every BrowserContext
so touchscreen is available and screenshot pixels map 1:1 to click coords.

## The test oracle

Without source code there's no ground truth. The oracle has three planned layers:

1. **Universal invariants** (implemented, `@cacqa/oracle`):
   - `balance-stable-without-money-action` — balance can't change without a bet/cashout
   - `balance-decreases-on-bet` — balance never increases after place-bet
   - `payout-matches-multiplier` — when multiplier × bet is known, payout must match
   - `cash-out-available-mid-round` — crash-style rule (currently a false-positive risk on slots; needs game-category gating)

2. **Per-game rule packs** (planned): a YAML/JSON spec referenced from
   `SessionSpec.rulesSpecRef` — RTP target, max multiplier, min/max bet,
   allowed currencies. The rule engine loads and validates extra rules from it.

3. **Statistical baselines** (planned): after N runs, flag outliers
   (a payout 5σ above historical, a multiplier never seen before).

Rules are pure `(context) => violations[]` functions — deterministic, no I/O.
Each is independently importable so customers can bring their own rule set.

## LLM provider and resilience

- Default provider is `gemini` → `gemini-2.5-flash-lite` (free tier, generous
  daily quota, accepts images and strict JSON).
- `GeminiProvider.generateWithRetry` retries 5xx / "overloaded" errors with
  exponential backoff (2s, 5s). 429 quota errors are **not** retried — they're
  authoritative, retrying burns more quota.
- `maxOutputTokens: 4096` accommodates busy game UIs; the prompt caps
  `elements[]` to 15 entries to keep output under that.
- Every LLM response is parsed through a Zod schema; invalid output becomes
  an `LLMError` with the raw JSON preserved for debugging.
- `UIElementSchema.kind` uses `.catch('unknown')` so novel widget types
  (checkbox, toggle, slider, link, icon) don't reject the whole response.
- `RoundInfoSchema` uses `.nullish()` — LLMs often emit explicit `null` for
  absent fields even when told to omit.

## Artifact naming

Every observation inside a round is persisted with a unique label, so
intra-round screenshots don't overwrite each other:

```
sessions/<id>/rounds/0/initial.png
sessions/<id>/rounds/-1/after-dismiss.png          # pre-flight dismiss cycle 1
sessions/<id>/rounds/-2/after-dismiss.png          # pre-flight dismiss cycle 2
sessions/<id>/rounds/1/action-0-after-place-bet.png
sessions/<id>/rounds/1/action-1-after-wait.png
```

Failures carry `screenshotBefore` / `screenshotAfter` keys into this tree so
a dashboard can render a flipbook of the moment a bug was caught.

## Path to multi-tenant SaaS

The pieces that make this monorepo a product (not just a tool):

- `OrganizationId` is in the domain from day 1. Every `SessionSpec` carries
  one. Multi-tenancy is additive — add a Postgres `organization_id` column
  and a NestJS guard, no domain changes.
- `LLMProvider` returns `TokenUsage` on every call. Metered billing is one
  observer away (write usage to a billing table per `organizationId`).
- Artifacts are addressed by deterministic key (`sessions/<id>/...`). Wire S3
  presigned URLs and the dashboard works against any storage backend.
- The worker's job runs entirely on a `BrowserContext` — one Chromium process
  hosts many sessions, dramatically cheaper than per-session launches.

## What's stubbed and where

| Stub                                       | Why                                          | Replace with                          |
| ------------------------------------------ | -------------------------------------------- | ------------------------------------- |
| `InMemorySessionRepository` (worker/infra) | Ship-able without Postgres                   | Prisma adapter + migration            |
| `LocalArtifactStore` (worker/infra)        | No infra needed for laptop dev               | S3 adapter using `@aws-sdk/client-s3` |
| Claude provider (`packages/llm/factory`)   | Avoid coupling MVP to a paid SDK             | Wire `@anthropic-ai/sdk`              |
| Dashboard                                  | Visual surface — not on the critical path    | API client + sessions table + replay  |
| Per-game rule packs                        | Need real games to author against            | YAML loader + Zod schema              |
| `cash-out-available-mid-round` rule        | Fires on slot games where concept is N/A     | Gate on game category / rule pack     |

Each stub honors a real port — the type system enforces the contract, so
swapping is mechanical.

## Conventions

- **Errors:** `AppError` subclass per kind. Adapters return
  `ResultAsync<T, SubError>`. Throwing is reserved for invariant violations.
- **IDs:** branded types (`SessionId`, `OrganizationId`, …). The compiler
  prevents passing a session id where an organization id is expected.
- **Money:** integer smallest-unit, never float. `mulMoney` rounds half-away-from-zero.
- **Logging:** structured pino, child loggers carry correlation ids
  (`{ sessionId, roundIndex, scenarioId }`).
- **Validation:** Zod at every boundary — env, request bodies, LLM responses,
  artifact metadata. Prefer `.optional()` / `.nullish()` over `.default()` in
  schemas shared across package boundaries; zod's `.default()` output-type
  inference interacts badly with `exactOptionalPropertyTypes: true`.
- **Empty OCR is non-fatal.** Canvas games rarely expose text to OCR; the
  LLM works from the raw screenshot. Vision adapter returns an empty blocks
  array rather than an error.
