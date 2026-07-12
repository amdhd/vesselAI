# VesselMind AI — Maritime Fleet Intelligence Platform

Read more: https://claude.ai/code/artifact/a66c0438-c2ea-43e1-a367-aafb05edf62f?open_in_browser=1&via=user_open&org=63d0e974-fa52-456b-bdb9-13c0df5dd129

A full-stack, AI-powered SaaS platform for oil & gas vessel fleet operators — six modules covering voyage optimization, predictive maintenance, emissions compliance, port scheduling, a technical-knowledge chat assistant, and SIRE inspection prep, all backed by the Anthropic Claude API.

I built and hardened this solo as a demo-day portfolio piece for Forward Deployed Engineering roles. The parts of the FDE job that matter most — wiring agentic AI into real data, defending trust boundaries, and debugging integrations end-to-end rather than trusting that they work — are exactly what this project is set up to show, not just describe.

**[The two FDE headline features](#the-two-features-that-matter-for-an-fde) · [Demo credentials](#demo-mode) · [What's real vs. mocked](#whats-real-vs-mocked) · [Engineering notes](#engineering-notes) · [How this maps to an FDE role](#how-this-maps-to-an-fde-role)**

---

## The two features that matter for an FDE

Everything else in this repo is context. These two are the point, because they are the parts of an FDE's job — *integrate a customer's data sources* and *configure agentic workflows* — that you can't fake.

### 1. A real data-ingestion pipeline

Three genuine ingestion paths land external data in Postgres, not fixtures dressed up as one:

| Source | Kind | What it does |
|---|---|---|
| **Open-Meteo Marine** (`services/weatherPipeline.ts`) | Keyless HTTP API | For each monitored point: **fetch → Zod-validate → transform → idempotent upsert**. Points run in parallel and are isolated — one bad point (network blip, malformed shape) is recorded but never aborts the run, so a run degrades *partially* instead of all-or-nothing. Re-runs are idempotent via a compound unique `(lat, lon, observedAt)`. |
| **aisstream.io** (`services/aisStream.ts`) | Live WebSocket firehose | Streams AIS vessel positions, upserted one-row-per-vessel by MMSI — bounded storage for a live map rather than an unbounded append log. |
| **ERP bunker CSV** (`services/bunkerImport.ts`) | Uploaded file | ERP-style bunker-procurement CSV: header validation, **per-row** Zod validation, bad rows collected and reported (not silently dropped), IMO→vessel resolution scoped to the caller's fleet. |

This is the FDE line "reliable data pipelines for ingestion, transformation, and validation" made concrete: bad rows, retries-friendly idempotency, and partial-failure handling are all present, not hand-waved.

### 2. A genuine agentic workflow

The route optimizer is a real **Claude tool-use agent loop** (`services/voyageAgent.ts`), not a single prompt. The agent is given four tools and reasons across multiple steps:

```
get_vessel_specs → get_route_info → get_marine_weather (both endpoints) → compute_fuel (2–3 candidate speeds) → recommend ONE speed
```

- Up to **8 agentic steps** (`MAX_STEPS`), the full tool-call trace returned to the UI so the reasoning is inspectable, not a black box.
- Tool execution is **tenant-isolated** — the vessel is the caller's fleet-resolved vessel, so even a prompt-injected agent can't reach another fleet's data.
- **Deterministic fallback**: on any API failure (bad key, rate limit, error) it computes a recommendation from the same physics the tools use and flags `fallback: true`, so the endpoint always returns a usable answer.

Served at `POST /api/voyage/agent-plan`.

---

## Modules

| # | Module | Purpose |
|---|--------|---------|
| 1 | Voyage & Route Optimizer | AI-recommended routing against a real fuel-consumption model, weighed against a live weather-risk profile |
| 2 | Predictive Maintenance | Equipment sensor trends, anomaly detection, AI root-cause analysis |
| 3 | Emissions & Compliance | IMO CII, EU ETS, MRV reporting |
| 4 | Port Scheduling & ETA | Congestion forecasting, demurrage exposure, AI-drafted agent correspondence |
| 5 | Vessel Knowledge Assistant | RAG-style technical chatbot scoped to a vessel's documentation |
| 6 | SIRE Inspection Prep | Readiness scoring, findings tracking, a simulated inspector chat for crew rehearsal |

## Tech Stack

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS + Recharts + Leaflet
- **Backend:** Node.js + Express + TypeScript + Prisma ORM
- **Database:** PostgreSQL 16
- **AI:** Anthropic Claude API, streamed (SSE) for chat, structured JSON for domain tasks
- **Testing:** Vitest — tenant isolation, JWT auth middleware, and the ingestion pipelines + voyage agent (parsers, CSV import, Open-Meteo transform)
- **Real-time:** Socket.io · **Auth:** JWT

## Architecture

```
                         ┌──────────────────────────────────────────┐
   External sources      │              VesselMind backend          │        Client
                         │              (Express + Prisma)          │
 Open-Meteo Marine  ─────┤                                          │
 (keyless HTTP)          │  ingestion → validate (Zod) → transform  │
                         │       → upsert (idempotent)              │    React + Vite
 aisstream.io       ─────┤                │                         │    ├─ Fleet map (Leaflet)
 (WebSocket firehose)    │                ▼                         │    ├─ 6 module dashboards
                         │           PostgreSQL 16                  │◄───┤─ Voyage agent trace UI
 ERP bunker CSV     ─────┤          (Prisma models)                │    └─ AI chat (SSE stream)
 (multipart upload)      │                │                         │
                         │                ▼                         │
                         │   Voyage AGENT loop ── tools ──┐         │
 Anthropic Claude   ◄────┤   get_vessel / get_route /     │         │
 (tool use + SSE)        │   get_weather / compute_fuel   │         │
                         │        (tenant-isolated)       ◄─────────┤  JWT + fleet-scoped
                         │   deterministic fallback ──────┘         │  tenant isolation
                         └──────────────────────────────────────────┘
```

Every external arrow is a **trust boundary**: input is validated before it's persisted, tool execution is scoped to the caller's fleet, and every AI path has a non-AI fallback so a provider outage degrades the demo instead of breaking it.

---

## What's Real vs. Mocked

A demo is only useful if you're honest about where the edges are. Here's the actual state, not the aspirational one:

| Area | Status |
|---|---|
| Auth, JWT, RBAC, tenant isolation | Real — Postgres-backed, IDOR-tested |
| Fleet & vessel data | Real — served from Postgres via Prisma, with an in-memory fallback if the DB is unreachable so the demo degrades instead of 500ing |
| Fuel consumption model | Real domain engineering — Admiralty Coefficient + speed-power curve, cited IMO MEPC sources (`backend/src/lib/fuelModel.ts`) |
| Claude integration (all 6 modules) | Real API calls, real prompts, real streaming — with a canned fallback on failure, flagged via an `X-AI-Fallback` header/field so degraded responses are never silently indistinguishable from real ones |
| Voyage agent (tool-use loop) | Real — multi-step Claude tool-use with a deterministic physics fallback (`services/voyageAgent.ts`) |
| Marine weather | **Real — live Open-Meteo Marine ingestion** into Postgres (`services/weatherPipeline.ts`), keyless |
| AIS vessel positions | **Real — live aisstream.io WebSocket** upserted into Postgres (`services/aisStream.ts`) |
| Bunker procurement | **Real — ERP-style CSV import** with per-row validation (`services/bunkerImport.ts`) |
| Equipment sensor telemetry, SIRE findings, port congestion, voyage history | Fixture data, generated with real-ish statistical variation (trends, noise, seeded anomalies) |

In a real engagement, swapping the remaining fixtures for a customer's SCADA feed or class-society data is exactly the data-integration work an FDE does. The three pipelines above show the pattern already working end-to-end; the rest is scoped, not faked.

---

## Engineering Notes

Two pieces of this codebase's history are worth walking through in an interview more than the feature list is.

**Security hardening arc.** An early version had a `demo_token_*` bearer-token prefix that bypassed real JWT verification and granted `fleet_manager` access to anyone who guessed it — added to make demo mode frictionless, and a real vulnerability. I found it, removed it, and followed up with IDOR fixes (a fleet-scoped tenant-isolation helper — `backend/src/lib/tenant.ts` — enforced consistently across every vessel/fleet/equipment route), prompt-injection guardrails on every AI chat surface, and per-user AI rate limiting. The commit history (`a7fc00b` → `5b62621`) is a legible before/after if you want to see the reasoning, not just the diff.

**The contract audit.** After the auth work, I went module-by-module through the live app — not reading code, actually clicking through every tab — and found that roughly a third of the app was silently broken: frontend and backend had drifted apart on API paths, response shapes (arrays wrapped in objects, `camelCase` vs different field names entirely, nested vs flat), and even units (an uppercase `'CRITICAL'` congestion enum on one side, lowercase `'congested'` on the other). Some of it 404'd. Most of it didn't — it just silently rendered `NaN`, blank charts, or crashed the whole React tree with no error boundary to catch it. I fixed each one at its root — reshaping API responses to match real consumer contracts rather than patching around them in the UI — and verified every fix live in a browser, not just by reading the diff. That's the muscle this role actually needs: not "does the code compile," but "does the demo you're about to show a customer actually work."

If you want specifics: `git log --oneline` tells the story in order, and every commit message explains *why*, not just *what*.

---

## Quick Start

### Prerequisites

- Node.js 20+
- Docker + Docker Compose
- An Anthropic API key ([console.anthropic.com](https://console.anthropic.com))

### 1. Configure

```bash
cp .env.example .env
# edit .env — set ANTHROPIC_API_KEY, and generate a real JWT_SECRET (32+ chars) if not running locally-only
```

### 2. Start with Docker (recommended)

```bash
docker compose up -d
docker compose exec backend npm run db:migrate
docker compose exec backend npm run db:seed
```

App runs at **http://localhost:5173**.

### 3. Manual setup (alternative)

```bash
# Backend
cd backend
npm install
npm run db:generate && npm run db:migrate && npm run db:seed
npm run dev          # http://localhost:3001

# Frontend (separate terminal)
cd frontend
npm install
npm run dev          # http://localhost:5173
```

### Run the tests

```bash
cd backend
npm test             # tenant isolation + JWT auth middleware, no DB required
```

---

## Demo Mode

Click **"Try Demo Mode"** on the login screen, or sign in with:

- **Email:** `demo@petronas.com`
- **Password:** `demo123`

This logs in as Captain Ahmad Fauzi, fleet manager for a 3-vessel fleet (MV Merdeka Spirit, MT Kerteh Venture, OSV Tenaga Satu). Pre-loaded scenarios worth showing:

- **Maintenance** — MV Merdeka Spirit has a turbocharger bearing anomaly with ~4 days to failure; ask the AI to analyze it.
- **Compliance** — MT Kerteh Venture is at a **D** CII rating (regulatory risk); the What-If Simulator shows the speed reduction needed to recover it.
- **Ports** — OSV Tenaga Satu is approaching a demurrage window at Port Fujairah.
- **Voyage** — run the Route Optimizer for Kerteh → Singapore and watch it call Claude live, then render the AI-recommended route on the map.

All AI features are live against your `ANTHROPIC_API_KEY` — nothing in the AI-generated output is scripted.

---

## API Routes

```
POST   /api/auth/login
POST   /api/auth/register
GET    /api/fleet
GET    /api/vessels/:id

# Voyage
POST   /api/voyage/optimize-route
POST   /api/voyage/agent-plan            # multi-step Claude tool-use agent
GET    /api/voyage/history/:vesselId
POST   /api/voyage/calculate-speed
GET    /api/voyage/active/:fleetId
POST   /api/voyage/predict-eta
POST   /api/voyage/generate-agent-message

# Data ingestion pipelines
POST   /api/weather/sync                 # run the Open-Meteo ingestion pass
GET    /api/weather/latest
GET    /api/weather/near?lat=&lon=
GET    /api/ais/positions                # live AIS positions from aisstream.io
GET    /api/ais/positions/near?lat=&lon=
POST   /api/imports/bunker               # upload ERP-style bunker CSV
GET    /api/imports/bunker/template

# Maintenance
GET    /api/maintenance/equipment/:vesselId
GET    /api/maintenance/sensor-data/:equipmentId
POST   /api/maintenance/analyze-anomaly
POST   /api/maintenance/work-order
GET    /api/maintenance/work-orders/:vesselId
GET    /api/maintenance/alerts/:vesselId

# Compliance
GET    /api/compliance/cii/:vesselId
GET    /api/compliance/ets/:vesselId
POST   /api/compliance/generate-mrv-report
POST   /api/compliance/chat

# Ports
GET    /api/ports/congestion
GET    /api/ports/demurrage/:vesselId

# Knowledge
POST   /api/knowledge/chat
POST   /api/knowledge/upload-document
GET    /api/knowledge/documents/:vesselId
POST   /api/knowledge/generate-defect-report
POST   /api/knowledge/handover

# SIRE
GET    /api/sire/readiness-score/:vesselId
POST   /api/sire/generate-pre-inspection-report
GET    /api/sire/documents/:vesselId
POST   /api/sire/inspector-simulation
GET    /api/sire/findings/:vesselId
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes in production | Min 32 chars — the app refuses to boot without one in production rather than fall back to an insecure default |
| `ANTHROPIC_API_KEY` | Yes | Anthropic Claude API key |
| `FRONTEND_URL` | Yes | Frontend origin, for CORS |
| `AISSTREAM_API_KEY` | No | Free key from [aisstream.io](https://aisstream.io) — enables the live AIS stream. Omit and the fleet map falls back to fixture positions |
| — | — | Open-Meteo Marine needs **no key**; the weather pipeline works out of the box |

---

## Project Structure

```
├── frontend/               React + Vite app
│   └── src/
│       ├── pages/          Route-level pages
│       ├── modules/        One folder per module (voyage, maintenance, compliance, ports, knowledge, sire)
│       ├── context/        Auth + fleet context
│       └── lib/            API client, shared types, utils
├── backend/                Express API
│   ├── src/
│   │   ├── routes/         Express routers, one per module
│   │   ├── services/       Shared Claude API helpers (prompt → JSON, SSE streaming, fallback handling)
│   │   ├── lib/             Tenant isolation, fuel model, JWT config, prompt-injection guardrails
│   │   ├── middleware/     Auth, validation, rate limiting, error handling
│   │   └── mock/           Fixture data (fleet/vessels are Postgres-backed when seeded; see above)
│   └── prisma/             schema.prisma + seed.ts
├── docker-compose.yml
└── .env.example
```

---

## Deployment

Backend + Postgres deploy to [Railway](https://railway.app); frontend deploys to [Vercel](https://vercel.com).

```bash
# Backend
npm install -g @railway/cli
railway login && railway init && railway up
# set ANTHROPIC_API_KEY, JWT_SECRET, FRONTEND_URL in the Railway dashboard

# Frontend
cd frontend && npx vercel deploy
# set VITE_API_URL to your Railway backend URL + /api
```

---

## How this maps to an FDE role

The Forward Deployed Engineer JD asks for specific things. Here's where each one lives in this repo:

| What the role asks for | Where it is here |
|---|---|
| *Integrate customer data sources* | Three real pipelines — Open-Meteo (HTTP), aisstream.io (WebSocket), ERP CSV (upload) — each landing validated data in Postgres (`services/weatherPipeline.ts`, `aisStream.ts`, `bunkerImport.ts`) |
| *Reliable pipelines for ingestion, transformation, validation* | Zod validation at every boundary, idempotent upserts, per-row / per-point failure isolation, bad-row reporting |
| *Configure agentic workflows; adapt agents* | Multi-step Claude tool-use loop with 4 tools and a deterministic fallback (`services/voyageAgent.ts`) |
| *Defend trust boundaries* | Fleet-scoped tenant isolation (`lib/tenant.ts`), IDOR fixes, prompt-injection guardrails on every AI surface, per-user AI rate limiting |
| *Move a POC toward production* | Prisma migrations, Docker Compose, graceful DB/AI fallbacks, `X-AI-Fallback` observability, seeded demo scenarios |
| *Communicate* | This README, honest "real vs. mocked" accounting, and commit messages that explain *why* |

## Roadmap (honest gaps)

These are scoped but not yet built — I'd rather name them than imply they're done:

- **CI/CD** — GitHub Actions to run lint + typecheck + the backend test suite on every PR (currently run by hand).
- **Live deployment + Terraform** — a public URL with a minimal Terraform module to provision it.
- **Frontend tests** — Vitest + Testing Library, plus backend route-integration tests (the current suite is unit/lib/middleware level).
- **Onboarding playbook** — a one-pager on how a new customer fleet gets connected, configured, and scoped for success.

---

## A Note on How This Was Built

I built this with Claude Code as a pair-programming tool — it's honest to say so, and given the target role is literally about deploying agentic AI systems, comfort directing one is more relevant here than it would be elsewhere. Every architectural call, every bug diagnosis, and every fix was verified by me, live, in a browser — not assumed from a diff. I'm glad to walk through the reasoning behind any specific decision in this repo.

## License

MIT
