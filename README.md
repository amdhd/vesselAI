# VesselMind AI — Maritime Fleet Intelligence Platform

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A full-stack, AI-powered SaaS platform for oil & gas vessel fleet operators — six modules covering voyage optimization, predictive maintenance, emissions compliance, port scheduling, a technical-knowledge chat assistant, and SIRE inspection prep, all backed by the Anthropic Claude API.

I built and hardened this solo as a demo-day portfolio piece for Forward Deployed Engineering roles. The parts of the FDE job that matter most — wiring agentic AI into real data, defending trust boundaries, and debugging integrations end-to-end rather than trusting that they work — are exactly what this project is set up to show, not just describe.

**[The FDE headline features](#the-three-features-that-matter-for-an-fde) · [Data warehouse](#3-an-analytics-warehouse-duckdb--dbt-medallion) · [Demo credentials](#demo-mode) · [What's real vs. mocked](#whats-real-vs-mocked) · [Engineering notes](#engineering-notes) · [How this maps to an FDE role](#how-this-maps-to-an-fde-role)**

---

## The three features that matter for an FDE

Everything else in this repo is context. These three are the point, because they are the parts of an FDE's job — *integrate a customer's data sources*, *configure agentic workflows*, and *model that data into something a decision can be made from* — that you can't fake.

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

### 3. An analytics warehouse (DuckDB + dbt medallion)

Ingestion gets data in; a warehouse makes it answerable. `data-platform/` is a full **bronze → silver → gold medallion pipeline** over public NOAA AIS vessel-tracking data, built with **DuckDB** (embedded OLAP — the warehouse is a single file) and **dbt Core**, and served into the app's **Fleet Analytics** page by a read-only FastAPI layer.

| Layer | Job | What's in it |
|---|---|---|
| **Bronze** (`ingestion/load_bronze.py`) | Land the source losslessly, every column `TEXT` | `bronze.ais_positions_raw` — the mess is kept on purpose, so data-quality problems are countable instead of invisible |
| **Silver** (dbt) | Make it correct: dedupe on `(MMSI, BaseDateTime)`, validate coordinates, cast types, drop rows with no MMSI | `silver.silver_ais_positions` — one trustworthy row per real ping |
| **Gold** (dbt) | Make it useful: star schema + business models | `dim_vessel`, `fct_vessel_daily` (pings, speed, haversine distance, first/last position per vessel-day), and `gold_vessel_idling` — idle-episode detection via a *gaps-and-islands* SQL pattern (fuel burn / port congestion) |

- **Tested, not just built:** **21 dbt data tests** across the four models (25 nodes build green) — schema tests plus singular tests asserting the unique grain of the silver ping and the daily fact.
- **Built for real scale:** the loader streams CSV off disk (never into pandas) and the transforms are plain SQL. Measured on a MacBook Air (16GB): **1.48M rows loaded in ~1.3s; dedupe + validation + tests in ~3.4s.** Real NOAA daily files are 5–12M rows; the committed sample is deliberately tiny so the repo runs instantly offline.
- **Two consumers, one gold layer:** a standalone **Streamlit** dashboard (KPIs, vessel map, distance chart, idling report) and the app's **Fleet Analytics** page via FastAPI (`data-platform/api/main.py`) — `/api/analytics/{summary,vessel-types,top-vessels,idling}`. Every endpoint is aggregated or top-N, so the React app never touches millions of raw rows.
- **Same trust boundary as the rest of the app:** the analytics endpoints verify the *same* app-issued JWT via a shared `JWT_SECRET` (HS256), with CORS restricted to an allowlist. A token from `POST /api/auth/login` is accepted unchanged; `/health` stays open.

**Why this exists next to Postgres:** AIS lives in two stores on purpose — a real-time **operational** store (Postgres `AisVesselPosition`, one row per vessel, powers the live map) alongside an **analytical** warehouse (DuckDB, millions of rows → small aggregates, powers Fleet Analytics). That's the standard hot-path/cold-path, OLTP-next-to-OLAP split every real data platform has, not redundancy.

Full detail — quickstart, how to swap in a real NOAA daily file, and the layer-by-layer reasoning — lives in [`data-platform/README.md`](data-platform/README.md).

```bash
cd data-platform && .venv/bin/uvicorn api.main:app --port 8000
```

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
- **Database:** PostgreSQL 16 (operational) · DuckDB (analytical warehouse)
- **Data platform:** Python 3.10 + dbt Core (bronze/silver/gold medallion) + FastAPI serving layer + Streamlit dashboard
- **AI:** Anthropic Claude API, streamed (SSE) for chat, structured JSON for domain tasks
- **Testing:** Vitest everywhere — backend unit tests (tenant isolation, JWT auth middleware, ingestion pipelines, voyage agent) plus supertest route-integration tests exercising the real Express app over HTTP; frontend unit + Testing Library component tests; dbt data tests and pytest on the data platform
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

Alongside that operational plane runs the **analytical** one — batch, not real-time, and deliberately separate:

```
 NOAA AIS daily CSV        DuckDB warehouse (data-platform/)                Client
 (5–12M rows/day)   ────►  bronze ──► silver ──► gold          ────►  FastAPI (:8000)  ────►  Fleet Analytics page
                           raw       dbt: dedupe  dim_vessel           /api/analytics/*        (JWT-verified,
                           as-is     + validate   fct_vessel_daily                              same app token)
                                                  gold_vessel_idling  ────►  Streamlit dashboard (:8501)
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
| AIS vessel positions | **Real — live aisstream.io WebSocket** upserted into Postgres (`services/aisStream.ts`); the operational surface is gated on fleet membership |
| Fleet Analytics | **Real — a separate DuckDB medallion pipeline** (NOAA batch → bronze/silver/gold, dbt-tested) served by a JWT-secured FastAPI layer (`data-platform/`) |
| Bunker procurement | **Real — ERP-style CSV import** with per-row validation (`services/bunkerImport.ts`) |
| Equipment sensor telemetry, SIRE findings, port congestion, voyage history | Fixture data, generated with real-ish statistical variation (trends, noise, seeded anomalies) |

In a real engagement, swapping the remaining fixtures for a customer's SCADA feed or class-society data is exactly the data-integration work an FDE does. The three pipelines above show the pattern already working end-to-end; the rest is scoped, not faked.

---

## Engineering Notes

Three pieces of this codebase's history are worth walking through in an interview more than the feature list is.

**Security hardening arc.** An early version had a `demo_token_*` bearer-token prefix that bypassed real JWT verification and granted `fleet_manager` access to anyone who guessed it — added to make demo mode frictionless, and a real vulnerability. I found it, removed it, and followed up with IDOR fixes (a fleet-scoped tenant-isolation helper — `backend/src/lib/tenant.ts` — enforced consistently across every vessel/fleet/equipment route), prompt-injection guardrails on every AI chat surface, and per-user AI rate limiting. The commit history (`a7fc00b` → `5b62621`) is a legible before/after if you want to see the reasoning, not just the diff.

**The contract audit.** After the auth work, I went module-by-module through the live app — not reading code, actually clicking through every tab — and found that roughly a third of the app was silently broken: frontend and backend had drifted apart on API paths, response shapes (arrays wrapped in objects, `camelCase` vs different field names entirely, nested vs flat), and even units (an uppercase `'CRITICAL'` congestion enum on one side, lowercase `'congested'` on the other). Some of it 404'd. Most of it didn't — it just silently rendered `NaN`, blank charts, or crashed the whole React tree with no error boundary to catch it. I fixed each one at its root — reshaping API responses to match real consumer contracts rather than patching around them in the UI — and verified every fix live in a browser, not just by reading the diff. That's the muscle this role actually needs: not "does the code compile," but "does the demo you're about to show a customer actually work."

**Review-driven hardening.** I ran a security-and-quality review over the merged code and fixed what it surfaced, each as its own reviewed PR: a **single shared PrismaClient** (six modules each constructed their own — six connection pools that would exhaust Postgres `max_connections` under load); **JWT auth + a CORS allowlist on the analytics service** (the FastAPI/DuckDB layer was reachable unauthenticated — it now verifies the *same* app-issued token via a shared `JWT_SECRET`); and a **fleet-membership gate on the live AIS map** (a self-service registrant with no fleet could read the operational map even though they see zero vessels everywhere else). Notably, I did **not** strictly per-fleet-scope AIS — it's public broadcast data about every vessel in the operating area, so faking ownership would blank the map; the right fix was to gate the *surface*, not fake the *data*, and to be able to say so.

That review also made the **two-plane data architecture** explicit, which is the part worth drawing on a whiteboard: AIS lives in two stores on purpose — a real-time **operational** store (Postgres `AisVesselPosition`, fed by the aisstream.io live feed, one row per vessel, powers the live map) alongside an **analytical** warehouse (DuckDB medallion pipeline, fed by NOAA batch files, millions of rows → small aggregates, powers the Fleet Analytics page). That's the standard hot-path/cold-path split every real data platform has — operational OLTP next to analytical OLAP — not redundancy.

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

### 4. Build the analytics warehouse (optional — powers the Fleet Analytics page)

Needs Python 3.10 (dbt doesn't support 3.14 yet). Full detail in [`data-platform/README.md`](data-platform/README.md).

```bash
cd data-platform
python3.10 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python notebooks_or_scripts/generate_sample_ais.py   # or drop a NOAA daily CSV in data/raw/
.venv/bin/python ingestion/load_bronze.py                      # bronze
cd dbt && ../.venv/bin/dbt build --profiles-dir . && cd ..     # silver + gold + 21 data tests
.venv/bin/uvicorn api.main:app --port 8000                     # serve gold to the app
```

### Run the tests

```bash
cd backend
npm test             # unit tests + supertest route-integration tests, no DB required

cd frontend
npm test             # Vitest + Testing Library

cd data-platform     # after step 4
.venv/bin/pytest api/test_auth.py                    # analytics API auth
cd dbt && ../.venv/bin/dbt build --profiles-dir .    # 21 warehouse data tests
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

# Fleet Analytics — served by the DuckDB warehouse's FastAPI layer (:8000), same JWT
GET    /api/analytics/summary
GET    /api/analytics/vessel-types
GET    /api/analytics/top-vessels
GET    /api/analytics/idling

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
| `VITE_ANALYTICS_API_URL` | No | Where the frontend looks for the analytics API (default `http://localhost:8000`) |
| `ANALYTICS_ALLOWED_ORIGINS` | No | CORS allowlist for the analytics API (comma-separated; defaults to the local Vite dev + preview ports). It reuses the app's `JWT_SECRET` — locally it self-resolves from `backend/.env`; in production set it explicitly on both |
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
├── data-platform/          DuckDB + dbt analytics warehouse (see its own README)
│   ├── ingestion/          load_bronze.py — raw NOAA AIS CSV → DuckDB bronze, untouched
│   ├── dbt/
│   │   ├── models/
│   │   │   ├── bronze/     Source declarations only (raw stays raw)
│   │   │   ├── silver/     silver_ais_positions.sql — dedupe, validate, type
│   │   │   └── gold/       dim_vessel, fct_vessel_daily, gold_vessel_idling
│   │   ├── macros/         Haversine distance, `between` test, schema naming
│   │   └── tests/          Singular tests: unique grains (silver ping, daily fact)
│   ├── api/                FastAPI serving layer over gold (JWT-verified) + auth tests
│   ├── dashboard.py        Streamlit dashboard over the gold tables
│   └── data/               data/raw/*.csv in, vesselmind.duckdb warehouse out
├── frontend-angular/       Angular ops dashboard over the same backend API
├── docker-compose.yml      + docker-compose.prod.yml
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
| *Model data so customers can act on it* | DuckDB + dbt medallion warehouse — bronze/silver/gold, star schema, 21 dbt data tests, served to the app through a JWT-secured FastAPI layer (`data-platform/`) |
| *Configure agentic workflows; adapt agents* | Multi-step Claude tool-use loop with 4 tools and a deterministic fallback (`services/voyageAgent.ts`) |
| *Defend trust boundaries* | Fleet-scoped tenant isolation (`lib/tenant.ts`), IDOR fixes, prompt-injection guardrails on every AI surface, per-user AI rate limiting |
| *Move a POC toward production* | Prisma migrations, Docker Compose, graceful DB/AI fallbacks, `X-AI-Fallback` observability, seeded demo scenarios |
| *Communicate* | This README, honest "real vs. mocked" accounting, and commit messages that explain *why* |

## Roadmap (honest gaps)

Scoped, understood, and not yet built — I'd rather name these than imply they're done:

- **Infrastructure as code.** The stack ships today via Docker Compose (`docker-compose.prod.yml`) with Railway + Vercel; provisioning is still click-ops. A minimal Terraform module would make an environment reproducible from an empty account.
- **Pipeline orchestration.** The medallion build is run on demand (`load_bronze.py` → `dbt build`). Production would want a scheduler (Dagster or Airflow), incremental models instead of full refreshes, and freshness alerting on the gold tables.
- **Onboarding playbook.** A one-pager on how a new customer fleet gets connected, configured, and scoped for success — the deployment-motion half of the FDE job, not the code half.
- **Remaining fixtures.** Equipment telemetry, SIRE findings, port congestion, and voyage history are still generated data. Swapping them for a customer's SCADA feed or class-society exports is the same ingestion pattern the three live pipelines already prove.

Already shipped and covered above: CI on every PR (`.github/workflows/ci.yml` — backend, frontend, Angular, data platform, Docker image builds), frontend component tests, backend route-integration tests, and a deployable production image.

---

## License

MIT — see [LICENSE](LICENSE).
