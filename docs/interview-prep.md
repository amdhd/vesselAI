# VesselMind AI — Interview Prep Knowledge Base

> Built from the actual code (backend read file-by-file; frontend, data platform, Angular, and tests covered by structured exploration passes). Every claim cites `file:line`. Context: this is a portfolio piece for a **Forward Deployed Engineer** role (agentic supply-chain AI company). The FDE angle matters as much as the engineering — the repo is built to demonstrate *integrating customer data sources, defending trust boundaries, and debugging integrations end-to-end*, not to be a production SaaS.

> **Platform companion:** [`K8S_INTERVIEW_PREP.md`](K8S_INTERVIEW_PREP.md) covers the Kubernetes and EKS side — IRSA, probes, sync waves, NetworkPolicy, storage, cost, and the nine bugs that only surfaced when the cluster was rebuilt from an empty AWS account.

---

## 1. Elevator pitch (30 seconds)

VesselMind is a full-stack, AI-powered **maritime fleet intelligence platform** for oil & gas vessel operators — six modules (voyage optimization, predictive maintenance, emissions compliance, port scheduling, knowledge chat, SIRE inspection prep) over a React frontend, an Express + Prisma + PostgreSQL backend, and Anthropic's Claude API.

Three things make it stand out: **(1)** a real multi-step **Claude tool-use agent** that plans voyages by calling four tools across up to 8 steps, with a deterministic physics fallback so the endpoint never 500s; **(2)** **three genuine ingestion pipelines** — keyless Open-Meteo weather (idempotent upserts, partial-failure isolation), a live aisstream.io WebSocket firehose (throttled, bounded storage), and an ERP-style bunker CSV importer with per-row validation; **(3)** a **two-plane data architecture** — operational OLTP in Postgres next to a DuckDB + dbt bronze/silver/gold medallion warehouse served to the app by a FastAPI layer that verifies the *same* JWT the backend signs.

Everything external is treated as a trust boundary: Zod validation at every input, tenant-isolated tool execution, and a non-AI fallback on every AI path — flagged via `X-AI-Fallback` so degraded output is never silently indistinguishable from real output. The "what's real vs. mocked" table in the README (README.md:130-141) is honest about which parts are live and which are fixtures — a deliberate FDE move.

---

## 2. Stack map

| Layer | Technology | Note |
|---|---|---|
| Web app | React 18.3 + TypeScript + Vite 5.4 + Tailwind + Recharts + Leaflet (`frontend/package.json:18-32`) | Six module folders under `src/modules/` |
| Client state | TanStack React Query 5.56 + IndexedDB persistence + PWA service worker (`frontend/src/main.tsx:38-53`) | Two overlapping offline layers (SW cache + query cache) |
| Ops dashboard | Angular 22 (standalone, signals, vitest-based) at `frontend-angular/` | Same backend API; shows modern Angular + RxJS→signal bridging |
| API | Express 4.21 + TypeScript, Zod 3.23 (`backend/package.json:22-33`) | One router per module under `src/routes/` |
| ORM/DB | Prisma 5.19 → PostgreSQL 16 (`backend/prisma/schema.prisma:5-8`) | Operational (OLTP) plane |
| Auth | jsonwebtoken HS256, bcryptjs cost 12 (`backend/src/lib/jwtConfig.ts`, `routes/auth.ts:117`) | Fleet-scoped tenant isolation in `lib/tenant.ts` |
| AI | `@anthropic-ai/sdk` 0.39, model `claude-sonnet-4-6` (`backend/src/services/aiService.ts:6`) | SSE streaming for chat, tool-use loop for the voyage agent |
| Realtime | Socket.io 4.7 (`backend/src/server.ts:26-39`) | `subscribe:fleet` rooms; 30s position heartbeat |
| Observability | pino (JSON, redaction) + prom-client (`backend/src/lib/logger.ts`, `lib/metrics.ts`) | `ai_requests_total` by label/outcome; latency histogram with route-pattern labels |
| Rate limiting | express-rate-limit 8.3 (`backend/src/middleware/rateLimiter.ts`) | 3 tiers: global, auth, per-user AI |
| Data platform | Python 3.10 + DuckDB + dbt Core (+ FastAPI, Streamlit) (`data-platform/`) | Bronze→silver→gold medallion; warehouse = one file |
| Analytics serving | FastAPI `data-platform/api/main.py`, port 8000 | Verifies the same app JWT (shared `JWT_SECRET`) |
| Infra | Docker Compose (dev + prod), Railway (backend), Vercel (frontend), GitHub Actions (`ci.yml`) | 5 jobs; no IaC yet (honest gap) |

---

## 3. Application architecture

### 3.1 The request lifecycle (Express)

`backend/src/app.ts` builds the app as a pure factory — `createApp(io?)` takes an optional Socket.io instance so supertest integration tests can build the real app without binding a port (`app.ts:29-36`). Middleware order, top to bottom:

1. **`dotenv/config` first import** (`app.ts:4`) — commented explicitly: `aiService` constructs the Anthropic client and `jwtConfig` reads `JWT_SECRET` at module-load time; a later `dotenv.config()` would leave them undefined. An ordering constraint, not a convention.
2. **`trust proxy`** (`app.ts:43-50`) — **off by default**. Why: trusting `X-Forwarded-For` when *not* behind a proxy lets clients spoof their IP and bypass IP-based rate limits. Prod compose sets `TRUST_PROXY=1` (`docker-compose.prod.yml:53`) because nginx is exactly one hop away.
3. **helmet** (`app.ts:52`) → **pino-http** with a custom log-level function (`app.ts:57-67`): `/api/health` and `/metrics` log at debug so probes don't flood info logs; ≥500 → error, ≥400 → warn. Logger redacts `authorization`, `cookie`, `password`, `token`, `apiKey`, `ANTHROPIC_API_KEY`, `AISSTREAM_API_KEY` (`lib/logger.ts:14-28`).
4. **metricsMiddleware** (`app.ts:70`, `lib/metrics.ts:35-41`) — starts a histogram timer per request; the route label uses the matched Express route *pattern* (e.g. `/api/voyage/history/:vesselId`), not the raw URL, so metric cardinality stays bounded (`lib/metrics.ts:29-32`). `/metrics` itself is optionally bearer-gated via `METRICS_TOKEN` (`app.ts:74-81`).
5. **apiLimiter** — 200 req / 15 min globally (`rateLimiter.ts:5-11`).
6. **compression with an SSE carve-out** (`app.ts:84-91`) — compression buffers responses, which breaks streaming; the filter explicitly excludes `text/event-stream`. Sharp detail: removing this filter breaks every AI chat stream, and the failure mode is *silent* (buffered chunks delivered at the end).
7. **CORS** on `FRONTEND_URL` only, credentials on (`app.ts:92-95`). **`express.json` capped at 1mb** (`app.ts:98-99`) — bodies are small chat/form payloads; a tight limit is DoS protection.
8. **`req.io` attach** (`app.ts:102-105`) → routes. `authLimiter` is mounted *only* on `/api/auth/login` and `/api/auth/register` (`app.ts:108-110`) — 5 failed attempts / 15 min, `skipSuccessfulRequests: true` (`rateLimiter.ts:15-22`).
9. **`/api` notFound** (`app.ts:128`) → **central errorHandler last** (`app.ts:130-132`) so `next(err)` is serialized consistently. The handler maps Prisma codes (`P2002`→409, `P2025`→404, `errorHandler.ts:25-39`) and only leaks `stack`/`details` in development (`errorHandler.ts:44`).

### 3.2 The per-route chain (the pattern every module follows)

`POST /api/voyage/agent-plan` (`routes/voyage.ts:134-148`) is the canonical example:

```
authenticate → aiLimiter → validate(OptimizeRouteSchema) → resolveFleetVessel → runVoyageAgent → res.json(plan)
```

- **`authenticate`** pins `algorithms: ['HS256']` (`middleware/auth.ts:41`) — defense-in-depth against algorithm-confusion attacks, since the secret is symmetric. Distinct 401 messages for expired vs. invalid tokens (`auth.ts:51-57`) — a testability/UX choice that a test suite pins (`middleware/auth.test.ts`).
- **`aiLimiter` runs AFTER authenticate** — it keys on `req.user.id` (10 calls/min/user) with an IP fallback (`rateLimiter.ts:26-39`). Ordering constraint: it must be after `authenticate` or the user key is never populated.
- **`validate`** Zod-parses the body, returns 400 with `flatten().fieldErrors` on failure, and *replaces* `req.body` with the parsed data (`middleware/validate.ts:4-14`) — downstream code trusts the schema, a "parse, don't validate" boundary.
- **`resolveFleetVessel`** (`lib/tenant.ts:44-54`) is the tenant boundary: the vessel comes from the caller's fleet (or the caller's first vessel when `vesselId` is omitted — the "lenient lookup" used by AI helper routes). It *never* returns another fleet's vessel. `requireVessel` (`tenant.ts:24-39`) is the strict variant: **404 for a vessel that doesn't exist, 403 for one that exists in another fleet** — the anti-IDOR distinction a test explicitly pins (`lib/tenant.test.ts:85-90`).

### 3.3 The core loop — the voyage agent (`services/voyageAgent.ts`)

The headline feature. The loop (`voyageAgent.ts:282-353`):

```
for step in 1..MAX_STEPS(8):
    messages.create(model, system, messages, tools=TOOLS)   // one real API call per iteration
    push assistant content onto messages
    if stop_reason != 'tool_use': return recommendation text
    for each tool_use block: execTool(ctx, name, input) → push tool_result
```

**WHY each non-obvious step:**
- **Tools are defined with JSON schemas but inputs are still Zod-validated in `execTool`** (`voyageAgent.ts:186,199,231`) — the model's tool args are untrusted input like anything else.
- **Tenant isolation lives in `execTool`**, not in the prompt: the vessel is captured in `ctx` at call time from the caller's fleet (`voyageAgent.ts:166-170`), so even a prompt-injected agent can't reach another fleet's data. The hermetic eval test forges a foreign `vesselId` to prove this (`voyageAgent.eval.test.ts`).
- **The weather tool has a 3-tier degradation path**: ingestion pipeline (`getObservationsNear` on Postgres) → live Open-Meteo fetch → `{error}` string back to the model (`voyageAgent.ts:198-229`).
- **`aiRequestsTotal.inc` inside the loop** (`voyageAgent.ts:318`) — each iteration is a real billed model call; the multi-call cost must show up in the same metric as single-call endpoints.
- **Non-convergence is a result, not an error**: hitting `MAX_STEPS` returns `incomplete: true` with the trace (`voyageAgent.ts:347`).
- **On any API failure → `deterministicPlan`** (`voyageAgent.ts:348-352`): same physics the tools use (`fuelForLeg`), same constants (`VLSFO_PRICE_PER_TONNE = 620`, `CO2_FACTOR_VLSFO = 3.151` — deliberately matched to the classic optimizer, `voyageAgent.ts:12-16`), flagged `fallback: true`. The endpoint *always* returns a usable answer.
- **The SSE variant validates + tenant-resolves BEFORE setting SSE headers** (`routes/voyage.ts:157-166`) — otherwise a 400/403 would be delivered as an empty event stream instead of clean JSON.

---

## 4. Deep dives

### 4.1 Auth & tenant isolation (the security arc)

**WHAT:** JWT (HS256, 7d expiry) carries `{id, email, role, fleetId, name}`; every vessel/fleet route goes through `lib/tenant.ts`; registrants get no fleet.

**WHY:** The README documents the history (README.md:151): an early version had a `demo_token_*` bearer prefix that bypassed real JWT verification and granted `fleet_manager` to anyone who guessed it — "added to make demo mode frictionless, and a real vulnerability." It was found, removed, and followed by IDOR fixes and guardrails. This arc *is* the FDE story: trust boundaries defended after a real break.

**Sharp details:**
- **Production refuses to boot without a ≥32-char `JWT_SECRET`** (`lib/jwtConfig.ts:12-25`) — fail-fast at boot rather than silently running with a forgeable secret. Dev falls back to a clearly-labelled dev secret with a logged `[SECURITY]` warning.
- **`fleetId` is intentionally NOT accepted in `RegisterSchema`** (`schemas/index.ts:20-24`) — comment: letting a self-service registrant pick their fleetId is *horizontal privilege escalation*; fleet assignment must come from a trusted admin/invite flow. Same for `VesselCreateSchema` (`schemas/index.ts:33-36`). This is "never trust a client-supplied tenant ID" made concrete.
- **Self-registered roles are allowlisted** (`routes/auth.ts:15`) — `fleet_manager | engineer | viewer` only; anything else silently defaults. Privileged roles can never be self-assigned.
- **Demo login is honored on two distinct paths** — DB unreachable *and* DB reachable-but-unseeded (`routes/auth.ts:60-73`) — and returns **503 with instructions** rather than 500 when the DB is down. `DEMO_LOGIN_ENABLED` is hard-gated to non-production (`jwtConfig.ts:31`).
- **The AIS exception** (`routes/ais.ts:8-12`, README.md:155): the live map is gated on *fleet membership* (`requireFleetMembership`, `tenant.ts:69-81`) but **not** per-fleet-scoped. Reasoning: AIS is public broadcast data about every vessel in the operating area — faking ownership would blank the map. The right fix was to gate the *surface*, not fake the *data*, and to be able to say why. A no-fleet registrant gets 403 on everything, including the map.
- **`requireVessel` returns 403 for cross-fleet, 404 for missing** (`tenant.ts:24-39`) — leaking "this vessel exists" to an attacker is an enumeration signal; conflating the two would also hide real IDORs in logs.

### 4.2 The AI service layer (`services/aiService.ts`)

**WHAT:** Two primitives every AI route builds on: `generateJson` (structured single-shot) and `streamChatResponse` (SSE chat). Both have canned fallbacks.

**WHY the fallback is *flagged*, not hidden:** `X-AI-Fallback: true` response header on every degraded JSON response (`aiService.ts:113`), and `aiFallback: true` **inside the SSE body** for streams (`aiService.ts:166`) — headers are already flushed by the time a stream fails, so the signal must ride in the event data. Without this, canned data is indistinguishable from real model output — "the demo lies without telling you."

**Sharp details:**
- **429s are classified separately** (`aiService.ts:64-74`): `Anthropic.RateLimitError` → `X-AI-Rate-Limited: true` + upstream `Retry-After` echoed, and the metric records outcome `rate_limited` vs `error`. Throttling is visible in logs/dashboards instead of silently collapsing into the generic fallback. `extractRetryAfter` probes both `Headers` and plain-record shapes because the SDK version changes the type (`aiService.ts:20-28`) — a vendor quirk handled defensively.
- **Token usage is logged per call** (`aiService.ts:37-56`) including cache read/creation tokens — ITPM/OTPM headroom and cost are observable, which is the FDE cost story.
- **`stripJsonFences`** (`aiService.ts:11-13`) — models wrap JSON in markdown fences; the parse tolerates it.
- **`SYSTEM_GUARDRAILS` is appended to every chat system prompt** (`lib/aiGuard.ts:1-16`): conversation history (including forged "assistant" turns) is declared untrusted input, not instructions. Plus structural bounds: conversation history ≤ 20 turns, ≤ 5000 chars per message (`schemas/index.ts:4-12`) — injection surface *and* token-cost DoS bounded at the schema.

### 4.3 Ingestion pipelines (the three real ones)

**Pipeline 1 — Weather (Open-Meteo, keyless):** `weatherPipeline.ts:25-64` + `openMeteo.ts`.
- **WHAT:** per monitored point: fetch (marine + forecast in parallel, shared 10s AbortController, `openMeteo.ts:116-147`) → Zod-validate → transform → idempotent upsert on compound unique `(latitude, longitude, observedAt)` (`schema.prisma:348`).
- **WHY:** points run in `Promise.all` with per-point try/catch (`weatherPipeline.ts:30-50`) — one bad point is *recorded in the summary*, never aborts the run. A run degrades *partially* instead of all-or-nothing. Re-runs are idempotent because of the compound unique.
- **SHARP DETAIL — the naive-GMT trap** (`openMeteo.ts:60-72`): Open-Meteo returns timestamps without an offset (e.g. `"2026-07-12T00:00"`); `new Date()` parses naive date-times as *local* time, which would shift every observation by the host's UTC offset — and corrupt the idempotency key. `parseProviderTime` explicitly stamps `Z` after checking for an existing offset. This is exactly the class of "the integration worked, the data was subtly wrong" bug an FDE lives for. Also: provider fields are nullable *on purpose* — coastal grid cells legitimately return null for wave/current values, only `time` is guaranteed (`openMeteo.ts:10-12`).

**Pipeline 2 — AIS (aisstream.io WebSocket):** `aisStream.ts` + `aisParser.ts`.
- **WHAT:** subscribes to a live firehose (`wss://stream.aisstream.io/v0/stream`) inside an SE-Asia bounding box, upserts one row per vessel (MMSI unique) → bounded storage for a live map, not an unbounded append log (`schema.prisma:352-354`).
- **WHY/mechanics:** write-throttled to one upsert per vessel per 30s (`aisStream.ts:15-16`); exponential reconnect 1s→60s, reset on open (`aisStream.ts:19-20, 66-67, 90-94`); no `ws` dependency — uses Node ≥22's global WebSocket via a minimal structural type (`aisStream.ts:22-34`).
- **SHARP DETAIL — `binaryType = 'arraybuffer'`** (`aisStream.ts:61-64`): aisstream sends binary frames; the default `blob` would stringify to `"[object Blob]"` and *every* `JSON.parse` would fail, silently dropping all data. Second: the subscription payload carries the API key and the error object can echo it, so neither is ever logged (`aisStream.ts:68-69, 85-88`). Third: the parser drops AIS "unavailable" sentinels (lat 91 / lon 181, heading 511) and strips `@`-padding from ship names (`aisParser.ts:46-75`) — the provider's "no data" values never pollute the map.

**Pipeline 3 — Bunker CSV import:** `bunkerImport.ts` + `csv.ts` + `routes/imports.ts`.
- **WHAT:** multipart upload (multer, in-memory, 5MB, CSV-only, `imports.ts:10-18`), `fleet_manager` role only (`imports.ts:25`) → parse → per-row Zod validation → fleet-scoped IMO resolution → `createMany` bulk insert → summary with per-row errors.
- **WHY hand-rolled CSV parser** (`csv.ts:1-9`): RFC-4180 state machine (quoted fields, escaped `""`, embedded newlines, CRLF, BOM) as a small pure testable function — real ERP exports contain exactly these edge cases, and a dependency buys nothing here.
- **SHARP DETAILS:** **(1)** fatal (missing required column, empty file) vs. per-row errors are distinct return shapes (`bunkerImport.ts:42-47`) — "this file is unusable" vs. "row 7 has a typo" must be different responses. **(2)** `'' → undefined` pre-process before number coercion (`bunkerImport.ts:9-13`) — an empty cell must *fail* required-number validation, not silently become 0. **(3)** tenant isolation via a **single fleet-scoped query** for all referenced IMOs (`bunkerImport.ts:124-130`) — a foreign fleet's IMO simply isn't found (row skipped with an error), and no per-row N+1.

### 4.4 The fuel model (`lib/fuelModel.ts`) — real domain engineering

**WHAT:** Layer 2 + 3 naval-architecture physics: Admiralty Coefficient (`C_adm = Δ^(2/3) × V³ / P`, derived at NCR = 85% MCR, full load — `fuelModel.ts:4-12, 58-62`) → speed-power curve with three corrections: partial-load SFOC (`0.455 × L^(-0.2) + 0.545`, clamped to [0.10, 1.0], CIMAC — `fuelModel.ts:92-95`), hull fouling (0.033%/day since drydock, capped 20%, IMO MEPC — `fuelModel.ts:104-109`), and trim (0.5%/m — `fuelModel.ts:116-118`). Power is capped at MCR with a `powerLimited` flag (`fuelModel.ts:172-174`).

**WHY:** the demo needed an answer an actual chief engineer would respect — and the *same* function backs the deterministic fallback, the classic optimizer, and the agent's `compute_fuel` tool, so all three paths produce comparable numbers. The CO₂ factor 3.151 (VLSFO, IMO MEPC.308(73)) appears in the model, the agent, and the route optimizer consistently (`fuelModel.ts:219`, `voyageAgent.ts:15`, `voyage.ts:65`).

**SHARP DETAIL — `||` vs `??` in ETA** (`routes/voyage.ts:283-286`): a `currentSpeed` of 0 (stopped vessel) must fall through to the planned speed — `??` would keep 0 and the ETA below divides by zero into an invalid date. The comment documents why. That's the level of detail that distinguishes code that survived real debugging.

### 4.5 Data platform (DuckDB + dbt medallion, `data-platform/`)

**WHAT:** NOAA AIS daily CSVs (5–12M rows/day in real life) → **bronze** (raw, every column TEXT, lossless) → **silver** (dedupe + validate + type) → **gold** (star schema: `dim_vessel`, `fct_vessel_daily`, `gold_vessel_idling`). 21 dbt data tests across 25 nodes. Served two ways: Streamlit dashboard and the app's Fleet Analytics page via FastAPI.

**WHY next to Postgres (the two-plane story, README.md:58, 157):** AIS lives in two stores *on purpose* — a real-time operational store (Postgres `AisVesselPosition`, one row per vessel, powers the live map) next to an analytical warehouse (DuckDB, millions of rows → small aggregates, powers Fleet Analytics). Hot path / cold path, OLTP next to OLAP — the standard split every real data platform has.

**Sharp details (per layer):**
- **Bronze** (`ingestion/load_bronze.py`): `all_varchar=true` + `CREATE OR REPLACE` — the mess is kept *on purpose* so data-quality problems are countable, not silently coerced away by DuckDB's type guesser. Idempotency = full replace; warehouse state depends only on `data/raw/`. Streamed off disk, never into pandas. `union_by_name` aligns daily files with differing column order.
- **Silver** (`models/silver/silver_ais_positions.sql`): the pipeline order is deliberate — **type → validate → dedupe**, so a corrupt duplicate is filtered out *first* and dedupe "is left choosing among genuinely-good rows." Dedupe uses DuckDB's `QUALIFY row_number() over (partition by mmsi, event_time order by sog_knots desc nulls last) = 1` — the winner is the highest-SOG ping, documented as "deterministic-but-arbitrary" (remaining dups are identical repeats). MMSI stays TEXT: "an identifier, not a quantity."
- **Gold facts** (`fct_vessel_daily.sql`): grain `(mmsi, activity_date)`; the `lag()` windows are partitioned *by day* — day-partitioning kills the phantom cross-midnight leg. **GPS-teleport filter:** a leg only counts if `gap_hours > 0` and implied speed ≤ `max_plausible_knots` (50, a dbt var) — else distance 0, but the ping stays in ping counts.
- **Idling = gaps-and-islands** (`gold_vessel_idling.sql`): `is_idle = sog ≤ 0.5` → `is_run_start = is_idle AND lag(is_idle) = 0` → `run_id = sum(is_run_start) over (partition by mmsi order by event_time)` → group by run_id, keep episodes ≥ 30 min. The running-sum trick assigns one id per contiguous idle run. **Known quirk:** duration is first-to-last idle-ping span, so the true duration is underestimated (no trailing gap closure).
- **Serving** (`api/main.py`): FastAPI + `HTTPBearer`; `jwt.decode(algorithms=["HS256"])` — same pinned algorithm as Express. **Secret resolution order: env var → hand-rolled parse of `backend/.env` → dev-only fallback → RuntimeError in production** (`api/main.py:31-70`) — no python-dotenv dependency, and prod refuses the dev fallback exactly like `jwtConfig.ts`. CORS allowlist (`ANALYTICS_ALLOWED_ORIGINS`), GET only. Every request opens a fresh `duckdb.connect(read_only=True)`. **Every endpoint is aggregated or top-N** (top-vessels default 15, idling default 25, both range-capped) — the React app never touches millions of raw rows.
- **Scale proof:** measured 1.48M rows loaded in ~1.3s, dedupe+validate+tests ~3.4s on a 16GB MacBook Air (data-platform/README.md:133).
- **Honest gap:** no incrementalism anywhere — bronze is `CREATE OR REPLACE`, every dbt model is a full-rebuild `table`; no `is_incremental()`, no freshness alerting, no orchestrator (run on demand). Named in the README roadmap (README.md:404).

### 4.6 Frontend resilience (React)

**WHAT:** React Query with IndexedDB persistence + PWA service worker + offline write queue + graceful demo fallbacks.

**Sharp details (each a probe-able decision):**
- **The cache buster** (`main.tsx:38-53`): `buster: 'v2-unwrapped-lists'`. Exists because a persisted wrong-shape payload (a list cached as a `{key:[...]}` envelope instead of the unwrapped array) rehydrated and crashed a view. Bumping it is a *manual* step — forget it after a response-shape change and users get stale-shaped data.
- **401 handling** (`api.ts:44-53`): interceptor removes the token and hard-redirects `window.location.href = '/login'` — a full reload, chosen to clear in-memory app state atomically rather than reconcile a soft redirect with every mounted module.
- **`X-AI-Fallback` header is never read by the frontend** — fallback state is surfaced via the `fallback` boolean in the agent-plan JSON body (amber badge, `AgentPlanner.tsx:293-297`). Honest weakness: the header observability is backend/monitoring-only today.
- **Offline queue** (`offlineQueue.ts`, `useNetworkStatus.ts`): only two endpoints queue writes (`createWorkOrder`, `markRead`); replay is sequential raw fetch; 4xx items are dropped, 5xx/network-throw items stay queued. **Replay only fires on the `online` event — never at boot** for an already-online session, and `navigator.onLine` reflects the network interface, not server reachability. Documented-in-code limitation.
- **AgentPlanner SSE client** (`AgentPlanner.tsx:138-183`): raw `fetch` + `TextDecoder({stream: true})` + manual `\n\n` frame splitting (axios can't stream SSE). The authoritative trace comes from the final `done` event's `result.toolCalls`, not the accumulated streamed events. **Known weakness:** a malformed frame throws and the whole run reports failure despite partial output; no AbortController, so unmounting mid-stream leaves setState on an unmounted component.
- **FleetContext silently falls back to mock data on any fetch failure — including an expired token** (`FleetContext.tsx:84-108`) — it bypasses the axios 401 redirect (raw fetch), so a stale session renders demo data instead of bouncing to login. A real degradation path worth naming in an interview: it's demo-friendly and observability-hostile.
- **Two overlapping offline layers**: the SW runtime-caches `/api/` GETs (NetworkFirst, 8s, 150 entries, 24h) *and* the query cache rehydrates from IndexedDB — redundancy by accident, but each covers what the other misses.

### 4.7 The Angular ops dashboard (`frontend-angular/`)

**WHAT:** Angular 22 standalone app (signals everywhere) over the *same* backend API — login, dashboard, vessels CRUD. Deliberately paired with the React app to show breadth.

**Sharp details:**
- Auth is a functional `CanActivateFn` returning a **`UrlTree`** (not `false`) to redirect to `/login` (`auth-guard.ts:25-34`); an interceptor pair splits concerns — `authInterceptor` attaches the token, `errorInterceptor` owns the response stream (401 → logout + "session expired" toast, always `throwError` onward so components *may* react but need not) (`error-interceptor.ts:20-49`).
- Toast is a **signal-based bus**, not an RxJS Subject (`notification.service.ts:19-35`) — a deliberate modern-Angular choice.
- Server-side search: `debounceTime(300) → distinctUntilChanged → switchMap` (race-free cancellation) bridged to a signal via `toSignal`, with filter/sort/paginate as chained `computed()`s (`vessels-page.ts:48-109`). The backend comment confirms the search query lands server-side rather than filtering every row client-side (`routes/fleet.ts:87-92`).
- The cross-field validator (`designSpeed ≤ maxSpeed`) is **mirrored server-side** as a Zod `.refine` (`vessel.validators.ts` vs `schemas/index.ts:53-56`) — validation at both ends, the client for UX, the server for truth.

---

## 5. Tradeoffs & decision summaries

| Decision | Chose | Rejected | Why / when the other wins |
|---|---|---|---|
| Prisma client instantiation | One shared client, `globalThis`-cached for hot reload (`lib/prisma.ts:3-18`) | Per-module `new PrismaClient()` (the original code — six connection pools) | Six pools exhaust Postgres `max_connections` under load. Cache layer exists because ts-node-dev re-evaluates modules per edit and would leak a pool per reload. |
| AI failure handling | Deterministic/canned fallback + explicit `X-AI-Fallback` / `aiFallback` flag | Fail the request (500) | Demo must always be usable; the *flag* is the fix for "canned data indistinguishable from real data." A production system might prefer failing loudly for correctness-critical domains. |
| Agent tool tenant isolation | Vessel captured in `ctx` at call time, tools only touch `ctx.vessel` | Trust the model to scope itself / pass fleetId through prompts | Prompt injection can't be prevented at the model layer; the data boundary must be enforced in the executor (`voyageAgent.ts:166-170`). |
| AIS map scoping | Fleet-membership gate on the surface, data unscoped | Per-fleet ownership filtering of public broadcast data | AIS is public data; faking ownership blanks the map. Gate the surface, not the data — and be able to say why (README.md:155). |
| Analytics auth | Verify the same app JWT (shared `JWT_SECRET`, HS256) in FastAPI | Separate auth service / open endpoint | One trust boundary, one login. The open-endpoint version shipped first and was fixed in review (README.md:155). Cost: secret must match on both services or every call 401s — documented gotcha (data-platform/README.md:202-210). |
| Warehouse serving | Bake the DuckDB file into the analytics image at build (build stage runs the pipeline) | Shared volume / live rebuild in the container | Read-only at serve time, scales horizontally with no writer coordination; freshness = image rebuild cadence (fine for demo, wrong for production — roadmap names orchestrator + incremental models as the fix). |
| Silver pipeline order | type → **validate → dedupe** | dedupe → validate | A corrupt duplicate filtered first means dedupe chooses among genuinely good rows. |
| AIS storage | One row per MMSI (upsert) + 30s write throttle | Append-every-message log | Bounded storage for a live map; the firehose can emit many msgs/sec/vessel. An analyst wanting history uses the *warehouse* plane instead. |
| Bronze fidelity | Every column TEXT, lossless, `CREATE OR REPLACE` | Type inference at ingest | Type-guesser silently coerces the mess to NULL and the data-quality problems become invisible. Typing is a silver concern. |
| CSV parsing | Hand-rolled RFC-4180 state machine | Library (e.g. papaparse) | Small, pure, testable; ERP exports hit exactly the quoting edge cases the state machine covers. A library wins when you need streaming > memory sizes or exotic dialects. |
| Rate limiting | 3 tiers: 200/15min global, 5/15min auth (skip successes), 10/min AI per-user | Single global limiter | Different failure costs: abuse, brute force, and *per-user API spend* need different windows and keys. AI is cost protection, keyed per authenticated user with IP fallback. |
| Trust proxy | Off by default, `TRUST_PROXY=1` only behind the known nginx hop | Always trust `X-Forwarded-For` | Enabling it without a proxy lets clients spoof IPs and bypass IP-based limits (`app.ts:39-43`). |
| Compression | Global, with `text/event-stream` excluded | Compress everything | Compression buffers responses and breaks SSE streaming — silently. |
| JWT secret policy | Refuse to boot in prod without ≥32-char secret; dev fallback with warning | Hardcoded default everywhere | Fail-fast beats running with a forgeable secret; frictionless local setup preserved. |
| Frontend 401 handling | Hard redirect (`window.location.href`) on 401 | Soft in-app redirect | Atomically clears all in-memory module state; the cost is a full reload. |
| Offline writes | Queue only 2 mutation endpoints in localStorage, replay on `online` event | Full offline-first sync engine | Scope matched to demo reality; full sync (conflict resolution, idempotency keys) is over-engineering here — and the queue's limits are documented in code. |
| React vs Angular | Both: React for the 6-module customer app, Angular 22 for the ops dashboard | One framework | Shows breadth (signals, RxJS bridging) over one API; Angular CI pins Node 24 vs 20 elsewhere (Angular 22 CLI needs ≥24.15 — `ci.yml:105-111`). |
| dbt utils | Hand-rolled `test_between` macro | `dbt_utils` package | Keeps the project fully offline — no `dbt deps` step (macro comment says so explicitly). |
| Eval strategy | Hermetic loop tests (scripted Claude stubs via `vi.spyOn`) in CI + opt-in live-API eval (`RUN_AGENT_EVALS=1`) | Only live evals | Live evals cost money and flake; hermetic tests prove loop mechanics for free; the live harness runs on demand and grades the trace deterministically. |

---

## 6. Observability, testing & CI/CD

### How you'd know it's broken

- **Structured logs (pino, JSON everywhere)** — module-scoped child loggers (`logger.child({ mod: 'ais' })`), redaction of credentials; health/metrics probes demoted to debug (`app.ts:57-67`).
- **Prometheus**: `http_request_duration_seconds` (route-pattern labels — cardinality-bounded) and `ai_requests_total{label, outcome}` where outcome ∈ success | rate_limited | error (`metrics.ts:19-24`). AI cost/reliability is a first-class series.
- **AI fallback visibility**: `X-AI-Fallback` / `X-AI-Rate-Limited` / `Retry-After` headers + `aiFallback`/`rateLimited` SSE body fields (`aiService.ts:113-117, 166`); per-call token usage log lines with cache tokens (`aiService.ts:42-55`).
- **`/metrics`** optionally bearer-gated via `METRICS_TOKEN` (`app.ts:74-81`); `/api/health` open; Docker HEALTHCHECKs on backend and analytics-api.
- **Ingestion run summaries** — `SyncSummary` (ingested/failed/errors per location) logged after every weather run (`weatherPipeline.ts:8-16, 62`); bunker import returns a per-row error report to the caller.

### Test strategy (and the honest gaps)

| Suite | Covers | Sharp detail |
|---|---|---|
| `routes/integration.test.ts` | Real `createApp()` over HTTP with **no DATABASE_URL** | DB-down is a *feature*: proves demo-login 200, non-demo login 503, tenant 200/403, AIS 403 for no-fleet JWT, structured 404. CI runs migrate against ephemeral Postgres, then tests *deliberately without* the DB env — flipping that would invert the assertions (`ci.yml:64-69`). |
| `services/voyageAgent.eval.test.ts` | Hermetic loop mechanics | Claude mocked via `vi.spyOn(anthropic.messages, 'create')` with scripted `tool_use`/`parallelToolUse` stubs — proves tool_result threading, MAX_STEPS, fallback, tenant isolation, parallel-tool batching; `get_marine_weather` deliberately avoided (touches Prisma + Open-Meteo). |
| `lib/tenant.test.ts` | IDOR semantics | Pins **403 for cross-fleet vs 404 for missing** (`tenant.test.ts:85-90`). |
| `middleware/auth.test.ts` | JWT edge cases | Expired vs invalid produce *distinct* 401 messages. |
| `evals/` | Live agent quality, opt-in | `RUN_AGENT_EVALS=1` gate; deterministic graders over the tool-call trace (converged, core tools called, cites distance verbatim, recommends a costed speed); cross-scenario invariant: economic speed ≤ fast speed; writes `evals/report.md`, exit 1 on failure. NOT in `npm test` (paid API). |
| dbt | 21 data tests | Schema tests + singular unique-grain assertions (`assert_silver_unique_ping`, `assert_fct_vessel_daily_unique_grain`); `transceiver_class` accepted_values at `severity: warn`. |
| `api/test_auth.py` | Analytics API auth | 5 cases incl. wrong-secret 401; DuckDB queries monkeypatched so tests verify auth+contract, not data. |
| Frontend/Angular | Thin | React: utils + LoginPage only; Angular: 2 spec files (guard + validators). No DB-backed tests anywhere; rateLimiter/errorHandler/fuelModel and most routes untested. **Say this plainly if asked.** |

### CI gates (`.github/workflows/ci.yml`)

Five jobs: backend (typecheck + test), frontend (test + build), angular (test + build, Node 24), data-platform (python 3.10 → `load_bronze` → `dbt build` → pytest), docker (5 build-only images — dev+prod backend, dev+prod frontend, analytics prod). Details that show care: least-privilege `contents: read` token; concurrency group cancels superseded PR runs; gha cache scoped per image; the analytics image build *runs the whole pipeline* so a failing dbt test fails the PR; the migrate step validates the migration chain against fresh Postgres; the Angular job's Node 24 pin is commented with the CLI requirement.

---

## 7. Infrastructure / deployment

- **Dev**: `docker-compose.yml` — postgres healthcheck gates backend; bind mounts + anonymous `node_modules` volume (host installs don't clobber Linux builds); dev JWT default is ≥32 chars precisely so `jwtConfig.ts` accepts it (compose comment explains why).
- **Prod**: `docker-compose.prod.yml` — secrets required via `:?` interpolation; **one-off `migrate` service** targets the `build` stage of the prod image (Prisma CLI is pruned from runtime), backend `depends_on: migrate: service_completed_successfully`; `TRUST_PROXY=1`; `restart: unless-stopped` everywhere.
- **Backend prod image** (4 stages: deps → build → prune → runtime): the **OpenSSL story** is the interview gem — Prisma's schema/query engines are dynamically linked against OpenSSL, `node:20-alpine` doesn't ship it, so `prisma migrate deploy` died with "Could not parse schema engine response" and the whole stack was undeployable (commit `8e2e995`). Fix: `apk add openssl` in **both** deps (migrations) and runtime (query engine), plus `dumb-init` as PID 1 (zombie reaping/SIGTERM), `USER node`, HEALTHCHECK.
- **Frontend prod image**: nginx-unprivileged; `VITE_API_URL=/api` (same-origin — no CORS, no hardcoded host) baked at build; `VITE_ANALYTICS_API_URL=/` with the comment that an empty value would fall back to `http://localhost:8000` in deployed browsers (`Dockerfile.prod:16-18`). nginx: `/api/analytics/` location **above** `/api/` (longest-prefix), `proxy_buffering off` + 300s read timeout for SSE, `/socket.io/` upgrade headers, `/assets/` immutable 1y, SPA fallback. Startup-ordering constraint: frontend `depends_on` analytics-api because nginx resolves upstream hostnames at startup or dies with "host not found" (`docker-compose.prod.yml:90-92`).
- **Analytics prod image**: build stage runs `load_bronze` + `dbt build` — the warehouse is baked in (gitignored otherwise), read-only at serve time, non-root `analytics` user, uvicorn with `--app-dir` so the import path matches local dev.
- **Cloud**: Railway (backend) + Vercel (frontend), click-ops — the README's roadmap *names* "no IaC" and "no pipeline orchestration" as gaps (README.md:403-404). Rollback = redeploy previous image; no blue/green. Cost model: everything is hobby-tier; the only per-request cost is the Anthropic API, which is why the AI rate limiter exists.

---

## 8. Live walkthrough script

The "walk me through this repo" answer, phased, with the exact file to open at each stop and ONE sharp detail per file.

**Phase A — Orientation (2 min)**
1. `README.md` → *"AI-powered maritime fleet intelligence, 6 modules; solo-built as an FDE portfolio piece."* Sharp: the **"What's Real vs. Mocked" table (README.md:130-141)** — honesty about fixture boundaries is the demo's credibility.
2. `docker-compose.prod.yml` → *"prod topology: postgres, one-off migrate, backend, analytics-api, nginx'd frontend."* Sharp: `:?` required-secret interpolation + migrate gating backend start (`:59-60`).

**Phase B — Backend core (5 min)**
3. `backend/src/server.ts` → *"bare httpServer before the app so Socket.io exists before `createApp(io)`."* Sharp: weather sync + AIS stream are **off by default**, env-gated (`:44-58`).
4. `backend/src/app.ts` → *"middleware chain: helmet → pino → metrics → limiter → compression → cors → json(1mb) → routes → notFound → errorHandler."* Sharp: compression excludes `text/event-stream` (`:84-91`) — delete that filter and every AI chat stream silently breaks.
5. `backend/src/middleware/auth.ts` → *"JWT middleware."* Sharp: `algorithms: ['HS256']` pinned (`:41`) — algorithm-confusion defense.
6. `backend/src/lib/tenant.ts` → *"fleet-scoped isolation."* Sharp: `requireVessel` 404-vs-403 split (`:24-39`) — the IDOR distinction tests pin.

**Phase C — The agent + AI layer (5 min)**
7. `backend/src/services/voyageAgent.ts` → *"the core loop: 4 tools, ≤8 steps, tool-call trace returned."* Sharp: tenant isolation lives in `execTool`'s `ctx`, not the prompt (`:166-170`).
8. `backend/src/services/aiService.ts` → *"generateJson + streamChatResponse, both with flagged fallbacks."* Sharp: rate-limit fallbacks carry the signal **in the SSE body** because headers are already flushed (`:122-172`).
9. `backend/src/lib/fuelModel.ts` → *"Admiralty Coefficient + SFOC/fouling/trim corrections."* Sharp: same function backs agent tools, deterministic fallback, and classic optimizer — numbers are comparable everywhere.

**Phase D — Ingestion (3 min)**
10. `backend/src/services/weatherPipeline.ts` → *"parallel, isolated, idempotent upserts."* Sharp: compound unique `(lat, lon, observedAt)` is the idempotency mechanism (`schema.prisma:348`).
11. `backend/src/lib/openMeteo.ts` → *"provider integration."* Sharp: naive-GMT timestamps are explicitly stamped `Z` or every observation shifts by the host's UTC offset (`:60-72`).
12. `backend/src/services/aisStream.ts` → *"WebSocket firehose → throttled upserts."* Sharp: `binaryType = 'arraybuffer'` — the default blob would stringify to `[object Blob]` and silently drop every frame (`:61-64`).
13. `backend/src/services/bunkerImport.ts` → *"per-row validated CSV import."* Sharp: `'' → undefined` before coercion so empty cells fail instead of becoming 0 (`:9-13`).

**Phase E — Data platform (4 min)**
14. `data-platform/ingestion/load_bronze.py` → *"lossless landing, everything TEXT."* Sharp: `CREATE OR REPLACE` — idempotent by full replace, mess preserved for counting.
15. `data-platform/dbt/models/gold/gold_vessel_idling.sql` → *"idle-episode detection."* Sharp: gaps-and-islands via `run_id = sum(is_run_start) over (...)`.
16. `data-platform/api/main.py` → *"JWT-verified serving layer."* Sharp: secret resolution env → `backend/.env` → dev fallback → **RuntimeError in prod** (`:31-70`) — same fail-fast policy as the backend.

**Phase F — Frontends (3 min)**
17. `frontend/src/main.tsx` → *"React Query + IndexedDB persister."* Sharp: the `'v2-unwrapped-lists'` buster (`:38-53`) — the scar from a persisted wrong-shape payload.
18. `frontend/src/modules/voyage/AgentPlanner.tsx` → *"SSE agent trace UI."* Sharp: authoritative trace comes from the final `done` event, not the accumulated stream (`:183`).
19. `frontend-angular/src/app/features/vessels/vessels-page.ts` → *"Angular 22 ops dashboard."* Sharp: `debounceTime → distinctUntilChanged → switchMap` server-side search bridged to signals.

**Phase G — Infra & close (2 min)**
20. `.github/workflows/ci.yml` → *"5 jobs."* Sharp: tests run **without** `DATABASE_URL` on purpose — DB-down is a tested feature (`:64-69`).
21. `backend/Dockerfile.prod` → *"4-stage prod image."* Sharp: OpenSSL in deps AND runtime — Prisma engines need it for migrations *and* queries (the `8e2e995` fix).
22. Close on `README.md` roadmap → *"honest gaps: no IaC, no orchestrator, remaining fixtures."* Sharp: naming gaps before the interviewer finds them *is* the FDE communication skill.

### Cheat-sheet table

| File | One-liner | The detail that makes you sound senior |
|---|---|---|
| `backend/src/app.ts` | Express app factory + middleware chain | Compression skips `text/event-stream` (`:84-91`); errorHandler must stay last (`:130-132`) |
| `backend/src/server.ts` | Entry: httpServer before app for Socket.io | Ingestion is env-gated off by default (`:44-58`) |
| `backend/src/middleware/auth.ts` | JWT verify + role gate | `algorithms: ['HS256']` pinned (`:41`) |
| `backend/src/lib/jwtConfig.ts` | Secret resolution | Prod refuses to boot on missing/short secret (`:12-25`) |
| `backend/src/lib/tenant.ts` | Fleet tenant isolation | 403 cross-fleet vs 404 missing (`:24-39`) |
| `backend/src/routes/auth.ts` | Login/register | Demo login honored on 2 paths; 503 + instructions when DB down (`:60-73`) |
| `backend/src/services/voyageAgent.ts` | Tool-use agent loop | Tenant isolation in `execTool` ctx (`:166-170`); MAX_STEPS→`incomplete: true` |
| `backend/src/services/aiService.ts` | Claude wrappers w/ fallbacks | `aiFallback` flag rides in SSE body — headers already flushed (`:166`) |
| `backend/src/lib/fuelModel.ts` | Admiralty + corrections | SFOC clamp [0.10, 1.0] avoids singularity (`:92-95`) |
| `backend/src/services/weatherPipeline.ts` | Open-Meteo ingestion | Compound unique makes reruns idempotent; per-point isolation (`:20-24`) |
| `backend/src/lib/openMeteo.ts` | Provider client | Naive-GMT stamped UTC or timestamps shift (`:60-72`) |
| `backend/src/services/aisStream.ts` | AIS WebSocket ingest | `binaryType='arraybuffer'` or every frame dies (`:61-64`) |
| `backend/src/services/bunkerImport.ts` | CSV import | Single fleet-scoped IMO query = tenant boundary + no N+1 (`:124-130`) |
| `backend/src/middleware/rateLimiter.ts` | 3 limiters | AI limiter keys per user, must run after authenticate |
| `backend/src/lib/prisma.ts` | Shared PrismaClient | globalThis cache for ts-node-dev reloads (`:9-17`) |
| `backend/prisma/schema.prisma` | Data model | `WeatherObservation` compound unique (`:348`); AIS one-row-per-MMSI |
| `data-platform/dbt/models/silver/silver_ais_positions.sql` | Clean layer | validate-before-dedupe ordering; `QUALIFY row_number()` |
| `data-platform/dbt/models/gold/gold_vessel_idling.sql` | Idle episodes | `run_id = sum(is_run_start) over (...)` gaps-and-islands |
| `data-platform/api/main.py` | Analytics serving | JWT verified, prod RuntimeError on dev secret; top-N endpoints only |
| `frontend/src/main.tsx` | Query client | `buster: 'v2-unwrapped-lists'` (`:38-53`) |
| `frontend/src/lib/api.ts` | Axios client | 401 → hard redirect; SSE via raw fetch (`:146-168`) |
| `frontend/src/lib/offlineQueue.ts` | Offline writes | Replay only on `online` event; 4xx dropped |
| `frontend-angular/.../vessels-page.ts` | Ops table | `switchMap` cancels stale searches |
| `backend/Dockerfile.prod` | Prod image | OpenSSL ×2 (migrations + query engine); dumb-init |
| `frontend/nginx.conf` | Prod proxy | `/api/analytics/` above `/api/`; `proxy_buffering off` for SSE |
| `.github/workflows/ci.yml` | CI | Tests run DB-less on purpose (`:64-69`) |
| `backend/evals/graders.ts` | Agent quality gates | Deterministic trace graders; distance must be cited verbatim |

---

## 9. Mock interview Q&A bank

### Screening

**Q1. Walk me through the architecture in two minutes.**
*Model answer:* VesselMind is an AI-powered maritime fleet ops platform. React SPA + Angular ops dashboard talk to an Express/TypeScript API over Prisma/Postgres; Claude powers six AI modules — the interesting one is a tool-use agent that plans voyages. Next to the operational Postgres plane sits a DuckDB+dbt medallion warehouse served by a JWT-shared FastAPI. Everything external is a trust boundary: Zod at every input, tenant-isolated tools, flagged AI fallbacks. Cite: README architecture diagrams, `app.ts`, `voyageAgent.ts`, `data-platform/`.

**Q2. Why two frontends?**
React is the customer-facing six-module demo (rich charts, maps, SSE traces); Angular 22 is an ops dashboard (forms, tables, search) over the *same* API. It demonstrates breadth — signals, functional guards, interceptor pairs — and mirrors how enterprises run an ops tool next to a customer product. Honest answer: it also made the repo more interview-complete as a portfolio.

**Q3. Why DuckDB next to Postgres instead of just Postgres?**
Two workloads: operational OLTP (one row per vessel, live map, auth) and analytical OLAP (millions of AIS rows → aggregates). DuckDB gives an embedded OLAP engine — a single file, no server, columnar scans, streams larger-than-RAM CSVs — and dbt gives tested versioned SQL transforms. It's the hot-path/cold-path split every real data platform has, at laptop scale.

**Q4. What's real vs. mocked in this app?**
Real: auth/JWT/RBAC, fleet data in Postgres (with in-memory fallback), the fuel model, Claude calls for all six modules (with flagged fallbacks), the voyage agent, all three ingestion pipelines, the warehouse. Mocked: equipment telemetry, SIRE findings, port congestion, voyage history — generated with realistic statistical variation. The README table (`README.md:130-141`) is the source of truth; being precise about the boundary is part of the demo.

**Q5. Why is this portfolio shaped for an FDE role?**
The FDE job is: integrate customer data sources, configure agentic workflows, defend trust boundaries, debug integrations end-to-end. The repo maps 1:1 — three ingestion pipelines, a real agent loop with tenant-isolated tools, the IDOR/auth hardening arc, and the contract-audit story where a third of the app was silently broken by frontend/backend drift (README.md:153). I'd rather show the debugging muscle than the feature list.

### Deep dives — backend & agent

**Q6. Walk me through the agent loop, step by step.**
System prompt defines a 4-step workflow (vessel specs → route info → weather at both endpoints → compute fuel at 2-3 candidate speeds) + guardrails. Loop ≤ `MAX_STEPS=8`: `messages.create` with tools; if `stop_reason != 'tool_use'`, the text is the recommendation; otherwise execute each `tool_use` block via `execTool(ctx, …)`, append `tool_result`s, repeat (`voyageAgent.ts:306-345`). Each iteration is a real billed call, counted in `ai_requests_total` (`:318`). Non-convergence returns `incomplete: true` with the trace; any API failure falls to `deterministicPlan` with `fallback: true` (`:348-352`).

**Q7. How do you prevent a prompt-injected agent from reading another tenant's data?**
The tools never take ownership data from the model. The vessel is resolved from the caller's fleet *before* the run and captured in `ctx`; `execTool` reads only `ctx.vessel` (`voyageAgent.ts:166-170`). The model can ask for any `vesselId` it wants in tool input — the input is Zod-validated and the vessel never changes. There's a hermetic test that forges a foreign vesselId to prove it. Defense in depth: SYSTEM_GUARDRAILS treats all conversation content as untrusted (`aiGuard.ts:1-16`), and history is structurally bounded (≤20 turns, ≤5k chars — `schemas/index.ts:4-12`).

**Q8. Why a deterministic fallback instead of returning an error?**
The endpoint's job is a usable voyage recommendation. On bad key/rate limit/500, `deterministicPlan` computes the same physics through the same `fuelForLeg` path with matched constants (VLSFO $620/t, CO₂ 3.151 — `voyageAgent.ts:12-16`), so the answer is comparable to a real agent run, and it's flagged `fallback: true` so nobody mistakes it for a model answer. Failing loudly would be the choice for a correctness-critical production domain; for a live demo, always-usable wins, and the flag keeps it honest.

**Q9. Your AI endpoints degrade on 429 — how is that different from other failures, and why does it matter?**
`classifyAiError` distinguishes `Anthropic.RateLimitError` (`aiService.ts:64-74`): outcome recorded as `rate_limited`, header `X-AI-Rate-Limited: true`, upstream `Retry-After` echoed. For SSE, the signal rides in the fallback chunk (`rateLimited`, `retryAfter`) because headers are flushed by the time a stream fails (`:122-172`). Why: throttling is an ops/cost signal — dashboards and clients can back off — and collapsing it into "AI error" hides that you're paying for demand you can't serve.

**Q10. What's the subtle timezone bug you'd hit in the weather pipeline if you removed one line?**
Open-Meteo returns naive GMT timestamps (no offset). `new Date("2026-07-12T00:00")` parses as *local* time, shifting every observation by the host's UTC offset. `parseProviderTime` detects the missing zone and stamps `Z` (`openMeteo.ts:60-72`). The sneaky part: it also feeds the compound-unique idempotency key `(lat, lon, observedAt)` — so the bug would corrupt both *when* data happened and whether re-ingestion duplicated it.

**Q11. A reviewer says "your rate limiter uses the default in-memory store, so rate limits don't work across replicas — fix it." Respond.**
Correct as an observation, incomplete as a review. Today the API is a single replica (compose/Railway), so the memory store is fine; `TRUST_PROXY=1` is set so `req.ip` is the real client. If we scaled out, yes — I'd move to a shared store (Redis) for the IP-keyed limiters, but I'd keep the AI limiter keyed per *user* from the JWT, which is store-independent. The invariant to preserve: `aiLimiter` must stay *after* `authenticate` in every route chain or the user key never populates (`rateLimiter.ts:24-25`).

**Q12. Why is `fleetId` rejected in the register schema — isn't that just validation?**
Because fleet membership *is* the authorization model: every vessel belongs to one fleet and `fleetVessels()` returns only the caller's fleet (`tenant.ts:9-13`). Accepting a client-supplied `fleetId` at signup is horizontal privilege escalation — anyone could join an existing tenant. Fleet assignment must come from a trusted admin/invite flow (`schemas/index.ts:20-24`). Same reasoning for vessel creation: the fleetId comes from the token, never the body (`schemas/index.ts:33-36`).

### Deep dives — data

**Q13. Walk me through your medallion layers and the responsibilities of each.**
Bronze lands losslessly — every column TEXT, `CREATE OR REPLACE`, filename tracked — so the source's mess is preserved and countable. Silver makes it correct: type → validate → **dedupe** in that order, so dedupe chooses among genuinely good rows; dedupe is `QUALIFY row_number() over (partition by mmsi, event_time order by sog_knots desc nulls last) = 1`. Gold makes it useful: star schema (`dim_vessel` + `fct_vessel_daily` at grain (mmsi, day)) plus a business model for idle episodes via gaps-and-islands. 21 dbt tests, including singular unique-grain assertions.

**Q14. What's the GPS-teleport filter and why does it exist?**
In `fct_vessel_daily`, consecutive pings are lag-joined *within a day partition* (so no phantom cross-midnight leg). A leg's implied speed is `raw_leg_nm / gap_hours`; if it exceeds 50 knots (a dbt var), the leg distance counts as 0 — the ping still counts. It defends against shared/spoofed MMSIs (two vessels one ID teleporting across the map) and GPS glitches. Known tradeoff: it also zeroes distance if a real vessel legitimately moved >50 kn — acceptable because >50 kn is impossible for commercial shipping, so the error is one-sided.

**Q15. How does gaps-and-islands detect idle episodes — and what's the known undercount?**
`sog ≤ 0.5 kn` flags an idle ping; `is_run_start = is_idle and lag(is_idle) = 0`; `run_id = sum(is_run_start) over (partition by mmsi order by event_time)`; then group by run_id and keep episodes ≥ 30 min. The duration is the span first-to-last idle ping — a trailing gap isn't added, so true idle time is underestimated. Naming that quirk unprompted is the senior move.

**Q16. How does the app's Fleet Analytics page authenticate against your Python service?**
Same trust boundary as the app: FastAPI verifies the *same* HS256 JWT the Express backend signs, with the algorithm pinned in `jwt.decode` too. Secret resolution: env `JWT_SECRET` → parse `backend/.env` → dev-only fallback → **RuntimeError in production** (`api/main.py:31-70`) — mirroring `jwtConfig.ts`'s fail-fast. CORS is an allowlist, GET only; every endpoint is aggregated or top-N so responses stay small. The documented gotcha: if the two services ever read different secrets, `/health` is 200 but every data route 401s (data-platform/README.md:202-210).

**Q17. Why is the warehouse baked into the Docker image at build time — doesn't that make it stale?**
The build stage runs `load_bronze` + `dbt build`, so a failing data test fails the *image build* (CI proves it — `ci.yml:220-224`), and the shipped artifact always contains a warehouse that passed its tests. At serve time it's read-only — per-request read-only DuckDB connections, no writer coordination, scales horizontally with zero shared volume. Freshness = rebuild cadence. That's the right trade for a demo; the README roadmap names the production answer (orchestrator + incremental models + freshness alerting) rather than pretending the image trick is one.

### Deep dives — frontend

**Q18. What happens when your API is unreachable in the browser?**
Three independent mechanisms: the service worker serves cached GETs (NetworkFirst, 8s timeout), React Query rehydrates from IndexedDB (busted cache version), and the offline queue holds the two queuable mutations for replay on the `online` event. Plus a visible NetworkStatus banner with the queue depth. Honest limitations: replay never fires at boot for an already-online session; `navigator.onLine` measures interface, not reachability; and FleetContext falls back to mock data on *any* fetch failure — including an expired token — because it bypasses the axios 401 redirect. That last one is demo-friendly and observability-hostile, and I'd flag it in a real deployment.

**Q19. Why do AI streams bypass axios?**
axios buffers responses; SSE needs a raw stream. The SSE consumers use `fetch` + `TextDecoder({stream: true})` + manual `\n\n` frame splitting (`api.ts:146-168`, `AgentPlanner.tsx:138-172`). The authoritative agent result comes from the final `done` event, not the accumulated stream events. Known weakness: a malformed frame throws and fails the whole run, and there's no AbortController — unmounting mid-stream can set state on an unmounted component.

**Q20. Your Angular search box — why not just filter the fetched rows client-side?**
Because the table is backed by a server-side search endpoint (`GET /api/vessels?search=`), and the component bridges RxJS to signals: `debounceTime(300) → distinctUntilChanged → switchMap` — `switchMap` cancels in-flight requests when the query changes, so stale responses can't arrive out of order and overwrite newer results. Client-side filtering only works until pagination or fleet size grows; the backend does a case-insensitive match on name/IMO/type/flag identically for DB and mock paths (`routes/fleet.ts:15-26, 87-106`).

### Infra / ops

**Q21. Tell me about the OpenSSL bug in your prod image.**
Prisma's schema and query engines are dynamically linked against OpenSSL; `node:20-alpine` doesn't ship it. `prisma migrate deploy` died with "Could not parse schema engine response", the one-off migrate service exited 1, and the backend's `depends_on: service_completed_successfully` blocked — the whole prod stack undeployable. Fix (commit `8e2e995`): `apk add openssl` in the deps stage (migrations) *and* the runtime stage (the query engine needs it at query time too, not just migration time). Verified end-to-end through nginx. Lesson: multi-stage images make "works in dev, dies in prod" failures invisible until the migrate one-off runs — which is why CI builds the prod image on every PR.

**Q22. What happens if I deploy this and the analytics container restarts faster than nginx?**
Nginx resolves `proxy_pass` upstream hostnames at startup — if the `analytics-api` container doesn't exist yet, nginx fails with "host not found in upstream". That's why the frontend service declares `depends_on: analytics-api` (`docker-compose.prod.yml:90-92`). It's a DNS-at-startup quirk, and the compose comment documents it.

**Q23. How do you know the migration chain is valid before a deploy?**
CI spins up an ephemeral Postgres and runs `npx prisma migrate deploy` from scratch — proving the whole chain applies cleanly to a fresh DB (`ci.yml:56-59`). Then the *test* step runs deliberately without `DATABASE_URL` because the integration suite asserts DB-unreachable behavior (demo login, 503s) — pointing it at the DB would invert those assertions (`ci.yml:64-69`). Deploys themselves run the same migrate-deploy one-off before the API starts.

**Q24. Cost model — what does it cost to run, and what did you do about it?**
Fixed infra is hobby-tier. The variable cost is the Anthropic API, per token — so: per-user AI rate limiting (10/min), token-usage log lines with cache tokens for headroom visibility, and deterministic fallbacks so rate limits degrade the demo instead of erroring. The eval harness is opt-in (`RUN_AGENT_EVALS=1`) precisely because it spends real API money. The frontend never reads `X-AI-Fallback` — a monitoring gap I'd close with a dashboard over `ai_requests_total{outcome}`.

### Behavioral / judgment

**Q25. "A reviewer says: `express-rate-limit` with default MemoryStore means your 200 req/15min global limit resets on restart — fix it." Respond.**
It's true, and it's also the least interesting of the three limiters. The auth limiter (brute force) and the AI limiter (cost) are the ones that matter; reset-on-restart is a mild brute-force advantage. My response: agree, note the scale precondition (single replica), and either move to a Redis store or — better — accept the reset for the global tier and keep per-user AI keying from the JWT. What I would *not* do is add Redis to a single-instance demo for a limiter reset that barely matters.

**Q26. What would you do differently at real scale?**
Five things, in order: (1) orchestrator + incremental dbt models + freshness alerting for the warehouse — the image-baked warehouse stops making sense; (2) IaC (Terraform) replacing click-ops Railway/Vercel, with env promotion; (3) shared rate-limit store and queue-backed replay with idempotency keys for the offline queue; (4) close the observability holes — the unread `X-AI-Fallback` header, FleetContext's silent mock fallback; (5) live-agent evals on a schedule with the graders I already have, plus prompt versioning. I'd also move JWT storage out of localStorage (httpOnly cookie) if auth hardening became real.

**Q27. "Why should I trust that your fallback numbers are right? You wrote the physics yourself."**
The model is sourced: Admiralty Coefficient, CIMAC SFOC curve, IMO MEPC biofouling and CO₂ factor references are cited in the code (`fuelModel.ts:1-24`). The same code path generates both the AI answer (via the `compute_fuel` tool) and the fallback — so the fallback's correctness is the tool's correctness, which is unit-tested deterministically. And the flag exists precisely so nobody *has* to trust it: `fallback: true` means "not the AI's answer", visibly. In production, I'd validate against a vessel's noon reports — the classic way to close the loop on fuel models.

**Q28. Walk me through a bug you'd actually expect to find in this codebase and how you'd hunt it.**
The class I'd bet on is contract drift — it already happened once: a third of the app silently broken by frontend/backend shape mismatches that didn't 404, just rendered NaN or crashed the tree (README.md:153). My hunt: start with the response-shape seam — Zod schemas on the backend, hand-typed `types.ts` on the frontend, no shared contract package — then check the degradation paths (mock fallbacks render silently), then the cache buster (a persisted old shape survives a deploy). The fix that stuck last time was reshaping API responses to match real consumer contracts, not patching the UI.

---

## 10. Red flags checklist — before approving an AI-suggested change, verify X

1. **JWT secret handling** — any change to `jwtConfig.ts` must keep the production-refusal path (`jwtConfig.ts:12-15`) and the ≥32-char rule. If the dev fallback becomes reachable in production, anyone can forge tokens.
2. **Shared secret across services** — the analytics API verifies the *same* HS256 token (`api/main.py`). Any change to where either side resolves `JWT_SECRET` must keep them identical, or every `/api/analytics/*` call 401s (data-platform/README.md:202-210). Both sides pin `algorithms: ["HS256"]`.
3. **Tenant isolation semantics** — changes to `tenant.ts` must preserve 403-for-cross-fleet vs 404-for-missing (`tenant.ts:24-39`); tests pin it (`tenant.test.ts:85-90`). A "helpful" change that returns 404 for cross-fleet access both leaks enumeration and hides IDORs.
4. **Registration payloads** — `RegisterSchema` and `VesselCreateSchema` must never accept `fleetId` (`schemas/index.ts:20-24, 33-36`); it's the horizontal-privilege-escalation boundary.
5. **Agent tool execution** — tools must read only `ctx.vessel` (caller-resolved); never let a tool accept vessel identity from the model (`voyageAgent.ts:166-170`). And the deterministic fallback must keep the shared constants (VLSFO 620, CO₂ 3.151, `voyageAgent.ts:12-16`) or agent and classic-optimizer numbers diverge.
6. **SSE plumbing** — three invariants: validate + tenant-resolve *before* setting SSE headers (`voyage.ts:157-166`); compression keeps excluding `text/event-stream` (`app.ts:84-91`); nginx keeps `proxy_buffering off` + long read timeout (`nginx.conf:43-44`). Breaking any one silently corrupts streaming.
7. **Weather idempotency** — the compound unique `(latitude, longitude, observedAt)` on `WeatherObservation` (`schema.prisma:348`) is what makes re-runs idempotent; dropping it makes every sync duplicate rows. Also: `parseProviderTime`'s UTC stamping (`openMeteo.ts:60-72`) feeds that key — don't "simplify" it.
8. **AIS bounded storage** — keep upsert-by-MMSI and the 30s write throttle (`aisStream.ts:15-16`); an append model turns a demo table into an unbounded log. Keep `binaryType = 'arraybuffer'` (`:64`) and never log the subscription payload (`:68-69`).
9. **Bunker CSV semantics** — the `'' → undefined` preprocess (`bunkerImport.ts:9-13`) must stay (empty cells fail, not coerce to 0), and the fleet-scoped IMO lookup (`:124-130`) is the tenant boundary — a "fix" that resolves IMOs globally reintroduces cross-tenant writes.
10. **Silver ordering** — validate-before-dedupe is deliberate (`silver_ais_positions.sql`); reordering lets corrupt rows win the dedupe. MMSI stays TEXT.
11. **Bronze losslessness** — `all_varchar=true` and full-replace semantics are the design; adding type inference at ingest silently destroys the data-quality signal.
12. **Frontend cache buster** — any change to a persisted response shape must bump the buster in `main.tsx:38-53`, or deployed browsers rehydrate stale-shaped payloads.
13. **VITE_ANALYTICS_API_URL** — must never be empty/falsy in the prod build; the client falls back to `localhost:8000` (`frontend/Dockerfile.prod:16-18`).
14. **Rate-limiter ordering** — `aiLimiter` must remain after `authenticate` in every route chain, or per-user keying silently degrades to IP (`rateLimiter.ts:24-38`).
15. **Shared PrismaClient** — never instantiate `new PrismaClient()` per module; six pools exhausted `max_connections` before (`lib/prisma.ts:3-11`).
16. **Prisma prod image** — keep OpenSSL in *both* deps and runtime stages (`backend/Dockerfile.prod:14-18, 40-41`) — the migration chain and the query engine each need it; removing either reproduces the `8e2e995` outage.
17. **nginx routing** — `/api/analytics/` must stay *above* `/api/` (longest-prefix) or analytics calls hit Express and 404 (`nginx.conf:21-32`); analytics-api must stay in the frontend's `depends_on` or nginx can fail at startup (`docker-compose.prod.yml:90-92`).
18. **CI DB-less tests** — the backend test step deliberately runs without `DATABASE_URL` (`ci.yml:64-69`); "improving" CI to always provide a DB inverts the graceful-degradation assertions.
19. **Angular CI Node pin** — keep Node 24 for the Angular job (CLI needs ≥24.15, `ci.yml:105-111`); "standardizing" all jobs on Node 20 breaks it.
20. **Demo login gating** — `DEMO_LOGIN_ENABLED` must remain non-production-only (`jwtConfig.ts:31`); and demo creds must never be accepted when `NODE_ENV=production`.
21. **Error-handler ordering** — `errorHandler` must remain the last middleware (`app.ts:130-132`); anything registered after it never runs, and Prisma-code mapping (P2002→409, P2025→404) lives there.
22. **`dotenv/config` ordering** — must stay the first import in `app.ts` (`app.ts:1-4`); module-load-time env reads (Anthropic client, JWT secret) break if it moves.
23. **Conversation-history bounds** — keep the ≤20-turn / ≤5k-char caps on chat schemas (`schemas/index.ts:4-12`); they bound both the injection surface and token-cost DoS.
24. **Trust proxy** — keep it off by default (`app.ts:43-50`); enabling it without a proxy lets clients spoof IPs and bypass IP-keyed limits.
