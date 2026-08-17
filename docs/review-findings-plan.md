# VesselMind — Review Findings & Fix Plan

> Produced from a full-repo review (backend read file-by-file; frontend, data platform, Angular, tests via structured exploration) on 2026-08-17. Every finding is verified against the code with `file:line`. Companion doc: [`docs/interview-prep.md`](interview-prep.md).

---

## A. Verified bugs (correctness — fix first)

### A1. Vessels created via the UI are invisible to every AI module
`POST /api/vessels` persists to Postgres with a `randomUUID()` id (`backend/src/routes/fleet.ts:127-131`), but the tenant resolver and all AI routes (voyage, maintenance, compliance, ports, knowledge, sire) resolve vessels from the in-memory `MOCK_VESSELS` only (`backend/src/lib/tenant.ts:44-54`, `resolveFleetVessel`). A created vessel shows up in `/api/fleet` but when the user runs the route optimizer with its ID, `resolveFleetVessel` finds no match and **silently falls back to the fleet's first mock vessel** — the plan is computed for the wrong ship with zero error. (`seed.ts` uses matching `fleet-001`/`vessel-001..003` IDs, so the seeded demo path is consistent — only *runtime-created* vessels diverge.)

**Fix options:**
- **(a, recommended)** Make `resolveFleetVessel`/`requireVessel` consult Postgres first, falling back to mocks — mirrors the read paths in `fleet.ts`. Correct; ~half a day; touches every AI route's data source.
- **(b)** Short-term: sync both stores on create. Hides the divergence instead of removing it.

### A2. `predict-eta` and `generate-agent-message` silently substitute a different voyage
Both use `find(v => v.id === voyageId && canAccess(...)) || find(v => canAccess(...))` (`backend/src/routes/voyage.ts:274-276, 329-331`). Request voyage X; if it isn't found you quietly get voyage Y's data. Tenant-safe (second find is fleet-scoped) but semantically wrong — the ETA or agent email is drafted for the wrong voyage.

**Fix:** when `voyageId` is provided and doesn't match an accessible voyage, return 404. Keep the fallback only for the no-`voyageId` case.

### A3. Offline queue never replays at app boot
Replay fires only on the browser `online` event (`frontend/src/hooks/useNetworkStatus.ts:17-45`). A user queues a work order offline, closes the tab, reopens while online: the write sits in localStorage forever (until the next offline→online cycle). Also, 4xx rejections are silently dropped — the user believes the work order synced.

**Fix:** flush on mount if `navigator.onLine`; surface dropped 4xx items in the NetworkStatus banner instead of deleting them silently.

### A4. AgentPlanner SSE: one malformed frame fails the whole run; no cancellation
`JSON.parse` of a malformed frame throws and the run reports failure despite partial output; no `AbortController`, so unmounting mid-stream leaves `setState` on an unmounted component (`frontend/src/modules/voyage/AgentPlanner.tsx:138-172`).

**Fix:** per-frame try/catch (skip bad frames); `AbortController` in the effect cleanup.

### A5. FleetContext masks auth failure as demo data
`FleetContext` fetches `/api/fleet` with raw fetch and falls back to mock data on *any* failure — including 401 from an expired token (`frontend/src/context/FleetContext.tsx:84-108`). An expired session renders the demo fleet as if logged in; it also bypasses the axios 401 redirect every other request uses.

**Fix:** distinguish 401 (redirect to `/login`) from network/5xx errors (mock fallback stays fine for those in demo mode).

---

## B. Robustness gap — the one that bites at demo time

### B1. AI JSON output is never schema-validated
`generateJson` does `JSON.parse(...) as T` and returns (`backend/src/services/aiService.ts:108-109`). Syntax errors fall back correctly, but a **well-formed wrong-shape** response (missing `aiRoute`, wrong types) passes straight through; routes spread it and the UI renders NaN. Given the contract-audit history (README.md:153 — a third of the app silently broken by shape drift), this is the most thematic fix: add an optional Zod schema parameter to `generateJson`, validate the parsed output, and fall back on schema failure. Turns every AI response boundary into a real contract.

---

## C. Security hardening (low severity, good story)

| # | Issue | Location | Fix |
|---|---|---|---|
| C1 | JWT in localStorage (XSS-exposed); client mints `demo_token_${Date.now()}` when API unreachable | `frontend/src/context/AuthContext.tsx:38-64`, `lib/api.ts:35-41` | Server no longer accepts demo tokens (hardened in the auth arc), so not exploitable — but move to httpOnly cookie for real deployments, or document explicitly |
| C2 | Self-registrants can request `fleet_manager` | `backend/src/routes/auth.ts:15` | Harmless today (fleetId-null gates everything), fragile tomorrow — drop from allowlist or comment tying it to the admin-assignment flow |
| C3 | `/metrics` bearer comparison isn't constant-time | `backend/src/app.ts:75` | `crypto.timingSafeEqual` on hashed values — trivial |
| C4 | `ENABLE_WEATHER_SYNC` + manual `POST /sync` can overlap runs | `backend/src/server.ts:44-52`, `routes/weather.ts:39` | Idempotent upserts make it benign, but a run mutex avoids duplicate outbound calls |

---

## D. Inefficiencies

1. **Warehouse full-rebuilds** — bronze is `CREATE OR REPLACE`, all dbt models are full `table` materializations; every `dbt build` is O(full data). Documented in the roadmap (README.md:404). Real fix: incremental models + orchestrator + freshness alerting. Biggest scale lever.
2. **Socket.io heartbeat sends only a timestamp** (`backend/src/server.ts:37-39`) — clients must refetch positions separately; either emit actual positions or drop the interval.
3. **`dim_vessel` `arg_max` per attribute** — N window passes per attribute; fine at tested scale, but one structured pass would halve them.
4. Minor: `env.ts` boolish transform silently maps `"banana"` → `false` instead of failing fast (`backend/src/config/env.ts:10-14`).

---

## E. Observability gaps

1. **UI never surfaces AI fallback** (verified: zero `aiFallback`/`X-AI-Fallback` references in `frontend/src`) — chat fallback chunks render as normal replies. Add a "degraded answer" badge in chat components reading the `aiFallback` SSE field, and a global banner for `X-AI-Fallback` on non-streamed calls.
2. **Evals are opt-in** (`RUN_AGENT_EVALS=1`, `backend/evals/run.ts:26-36`) — correct for cost; consider a scheduled CI run with a small token budget (graders are already deterministic).

---

## F. Test coverage (verified thin spots)

Untested: `fuelModel.ts` (pure math — highest value-per-effort), `errorHandler.ts`, `rateLimiter.ts`, most route modules; no DB-backed integration test anywhere; Angular has 2 spec files; React has 2 test files. CI already proves the migration chain against fresh Postgres (`ci.yml:56-59`) — a DB-backed integration job for `fleet.ts` would close the A1 blind spot.

---

## G. Roadmap items already named in the README (validate, don't re-litigate)

IaC for Railway/Vercel, pipeline orchestration, onboarding playbook, remaining fixtures (README.md:399-406).

---

## Suggested implementation order

**Phase 1 — demo-correctness (1 focused session each):**
1. A2 (small, isolated)
2. A1 (touches the trust boundary — highest interview value)
3. B1 (Zod-validate AI JSON)
4. A3 / A4 / A5 (frontend, each < 1 hour)

**Phase 2 — hardening & observability:**
C3, C2 comment, E1 (fallback badges), then `fuelModel` + `errorHandler` tests.

**Phase 3 — platform work:**
D1 (incremental dbt + scheduler), D2, IaC — multi-session; the README already frames them honestly.

**Open judgment call:** A1's fix shape — Postgres-first `resolveFleetVessel` (recommended: it's the "DB and in-memory fixtures diverged" bug class, and removing it is a strong interview story) vs. documenting the divergence as a known demo limitation.
