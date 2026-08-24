# VesselMind AI — Maritime Fleet Intelligence Platform

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A full-stack, AI-powered SaaS platform for oil & gas vessel fleet operators — six modules covering voyage optimization, predictive maintenance, emissions compliance, port scheduling, a technical-knowledge chat assistant, and SIRE inspection prep, all backed by the Anthropic Claude API.

I built and hardened this solo as a demo-day portfolio piece for Forward Deployed Engineering roles. The parts of the FDE job that matter most — wiring agentic AI into real data, defending trust boundaries, and debugging integrations end-to-end rather than trusting that they work — are exactly what this project is set up to show, not just describe.

**It also runs on Kubernetes, twice.** The same manifests deploy to a local k3d cluster and to a real **AWS EKS** cluster built from an empty account by Terraform — VPC, ECR, IRSA, an ALB with an ACM certificate, KMS-encrypted Secrets, GitOps reconciliation by Argo CD, and a measured load test on both. The EKS run is where the interesting failures were: nine bugs that a laptop cluster could not have surfaced, each one written up in [Running on Kubernetes](#running-on-kubernetes) rather than quietly fixed.

**[The FDE headline features](#the-three-features-that-matter-for-an-fde) · [Data warehouse](#3-an-analytics-warehouse-duckdb--dbt-medallion) · [Kubernetes & EKS](#running-on-kubernetes) · [Demo credentials](#demo-mode) · [What's real vs. mocked](#whats-real-vs-mocked) · [Engineering notes](#engineering-notes) · [How this maps to an FDE role](#how-this-maps-to-an-fde-role)**

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

**Platform:** Kubernetes (k3d/k3s), Kustomize, Argo CD, Traefik Ingress, Sealed Secrets, Prometheus + Grafana, Trivy, k6.

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
├── k8s/                    Kubernetes manifests — one base, two clusters
│   ├── base/               Namespace through ResourceQuota, heavily commented
│   ├── overlays/dev/       k3d: local registry, laptop-sized quotas
│   ├── overlays/prod/      EKS: ALB ingress, gp3 storage, GHCR digests, re-sealed secrets
│   ├── overlays/prod-monitoring/  EKS-only Grafana ingress
│   ├── aws/                Vendored controllers with no managed addon (LB controller,
│   │                       cluster autoscaler, sealed secrets) — pinned, not fetched
│   ├── argocd/             Argo CD config: least-privilege RBAC, AppProject, Applications
│   ├── jobs/               Break-glass restore Job
│   ├── loadtest/           k6 script + in-cluster Job
│   └── scripts/            Pre-apply checks (quota headroom, image refs), EKS re-seal
├── terraform/              EKS from an empty AWS account
│   ├── vpc.tf              Subnets with the discovery tags the ALB controller needs
│   ├── eks.tf              Control plane + the OIDC provider IRSA depends on
│   ├── nodes.tf            Node group sized from measured demand, not guessed
│   ├── addons.tf           EBS CSI (IRSA), VPC CNI (NetworkPolicy + prefix delegation)
│   ├── external-dns.tf     Route 53 writes scoped to one hosted zone
│   ├── github-oidc.tf      CI pushes to ECR with no stored AWS keys
│   ├── kms.tf              Envelope encryption for Secrets; EBS encrypted by default
│   ├── policies/           Vendored upstream IAM policy, with an honest README
│   └── Makefile            `make destroy` in the order that actually works
├── docs/EKS.md             Bootstrap runbook — each step says what breaks if run early
├── docker-compose.yml      + docker-compose.prod.yml
└── .env.example
```

---

## Deployment

Three options, in increasing order of realism:

| | What it is |
|---|---|
| Docker Compose | `docker-compose.prod.yml` — multi-stage non-root images, migrations as a one-off, secrets from the environment |
| Railway + Vercel | Managed hosting, described below |
| **Kubernetes** | The full stack on k3d, deployed by Argo CD — see [Running on Kubernetes](#running-on-kubernetes) |

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

## Running on Kubernetes

The whole stack runs on **two** clusters from the same manifests: a local k3d
cluster for development, and a real **AWS EKS** cluster provisioned by Terraform
from an empty account. Both are deployed by Argo CD from this repository.
Manifests live in `k8s/` (base + Kustomize overlays), infrastructure in
`terraform/`; every non-obvious decision is commented in the file it applies to.

| | k3d (local) | EKS (AWS) |
|---|---|---|
| Cluster | k3s v1.35.5, 1 server + 2 agents | EKS 1.36, 3× t3.medium |
| Ingress | Traefik (bundled) | AWS Load Balancer Controller → one shared ALB |
| TLS | Traefik self-signed | ACM wildcard, browser-trusted |
| Storage | local-path | gp3 via EBS CSI, encrypted |
| DNS | `localhost` | external-dns → Route 53 |
| Secrets | Sealed Secrets | Sealed Secrets + KMS envelope encryption |
| Cost | free | ~$0.28/hr, torn down after each session |

The EKS side is a **burst** cluster: built, exercised, destroyed. Full procedure
and the reasoning behind each step is in [`docs/EKS.md`](docs/EKS.md).

```bash
k3d cluster create vesselmind --agents 2 \
  --registry-use k3d-vesselmind-registry:5111 \
  -p "8080:80@loadbalancer"

kubectl apply -k k8s/overlays/dev
```

Both `--registry-use` and the port mapping can only be set **at cluster
creation** — worth deciding up front rather than discovering one rebuild at a
time.

| Surface | URL |
|---|---|
| App | `http://localhost:8080` |
| Grafana | `http://localhost:8080/grafana` |
| Argo CD | `http://localhost:8080/argocd` |

### Workloads, and why each got its object type

| Workload | Object | Why |
|---|---|---|
| Postgres | StatefulSet + headless Service + volumeClaimTemplate | Stable identity and stable storage. Gives neither replication nor HA — that needs an operator or RDS |
| Express API | Deployment + ClusterIP Service + HPA | Stateless and interchangeable, so rolling replacement is correct |
| React SPA | Deployment + ClusterIP Service | Static files from nginx; the **Ingress** does the routing, not nginx |
| Analytics (FastAPI + DuckDB) | Deployment + PVC | Reads a warehouse a CronJob rebuilds |
| Background worker | Deployment, 1 replica, `Recreate` | Weather ingestion and the AIS consumer. One replica by construction — see below |
| Migrations + seed | Job (initContainers, then a main container) | Runs once and stops. An initContainer on the API would re-run on every pod start, forever |
| Backups, warehouse refresh | CronJobs | Scheduled batch, with `concurrencyPolicy: Forbid` and bounded history |
| Credentials | SealedSecret | Encrypted in git; only the in-cluster controller can decrypt |

Entry point is a single Traefik Ingress with path fan-out — `/api/analytics` to
the analytics service, `/api` and `/socket.io` to the API, everything else to the
SPA. Longest-prefix wins, and same-origin means no CORS to configure.

### Measured autoscaling and load test

k6, driven through the Ingress at `http://localhost:8080` — the same path a
browser takes, so Traefik's capacity is included rather than bypassed. The
endpoint under test is `GET /api/fleet`: authenticated, and backed by a Postgres
query through Prisma. `/api/health` would give prettier numbers and prove
nothing, since it never touches the database.

Profile: 60 virtual users, 30s ramp / 120s hold / 30s ramp-down.

| Metric | Result |
|---|---|
| Requests | 85,534 |
| Throughput | **473.6 req/s** |
| Latency p95 | **11.04 ms** |
| Latency median | 3.87 ms |
| Failed requests | **0** |
| Rate-limited (429) | **0** |
| Replicas | **3 → 8** |
| HPA decision → new pods Ready | **12 s** |

From the HPA's own events:

```
10:56:32Z  SuccessfulRescale  New size: 7   (cpu above target)
10:56:47Z  SuccessfulRescale  New size: 8   (cpu above target)
```

Two steps 15 seconds apart, matching the configured policy period. `scaleUp` and
`scaleDown` are deliberately asymmetric — zero stabilisation up, 300s down —
because scaling up early wastes a little CPU while scaling down early drops
requests. Visible in the result: after load stopped, CPU fell to 14% and the
deployment held at 8 replicas rather than flapping.

**Caveats, because numbers are only worth what they disclose:**

- The HPA **hit its `maxReplicas` ceiling of 8**, so this measures the ceiling,
  not where it would have settled. 8 is bounded by a 5-core laptop, not the app.
- `/api/fleet` returns 3 seeded vessels from a tiny database.
- Load originates on the same machine as the cluster — no real network.
- The rate limit was raised for the test, in the dev overlay, and labelled as a
  load-testing setting rather than passed off as a production default.


#### The same test on EKS

Re-run against the EKS cluster (3x t3.medium, EKS 1.36), k6 running **inside**
the cluster as a Job against the `api` Service. In-cluster rather than from a
laptop for two reasons: driving us-east-1 over the internet puts 200ms+ of WAN
round trip into every sample and measures the internet rather than the
application, and the Phase 7 NetworkPolicy only admits in-namespace pods anyway.

| Metric | k3d (laptop) | EKS |
|---|---|---|
| Requests | 85,534 | 41,310 |
| Throughput | 473.6 req/s | **227.1 req/s** |
| Latency p95 | 11.04 ms | **287.5 ms** |
| Latency median | 3.87 ms | 102.7 ms |
| Failed requests | 0 | **0** |
| Rate-limited (429) | 0 | **0** |
| Replicas | 3 → 8 | **3 → 10** |
| CPU at steady state | — | **~60%** (target is 60%) |

**EKS is roughly half the throughput and 25x the p95, and that is the honest
result rather than a disappointing one.** Three things account for it, and none
is a misconfiguration:

- **t3.medium is burstable.** Baseline is 20% of 2 vCPU; a sustained run drains
  CPU credits and throttles to that baseline. A laptop core has no such ceiling.
  For numbers that measure the application rather than the credit balance, run
  this on `c5.large` — non-burstable, and about the same hourly price.
- **Real network.** Pod-to-pod and pod-to-Postgres hops cross an AZ boundary
  rather than a loopback interface.
- **Postgres on EBS**, not the laptop's NVMe.

What the run does demonstrate cleanly is the autoscaler. Sampled every 10s:

```
t+030s  cpu=14%   desired=3   ready=3
t+040s  cpu=14%   desired=7   ready=3     <- HPA reacts
t+050s  cpu=153%  desired=7   ready=3
t+060s  cpu=192%  desired=10  ready=7
t+070s  cpu=188%  desired=10  ready=10    <- ~30s decision to Ready
t+090s  cpu=65%   desired=10  ready=10
t+150s  cpu=60%   desired=10  ready=10    <- converged on the 60% target
t+180s  cpu=3%    desired=10  ready=10    <- load gone, replicas held
```

The last two lines are the interesting ones. CPU converged to 60% — the HPA's
own target — and then, once load stopped, replicas stayed at 10 rather than
collapsing. That is the 300s scale-down stabilisation window, and seeing it hold
is the point of measuring rather than assuming.

The cluster autoscaler had nothing to do: 10 replicas fit on the existing three
nodes, so no node was added. `node_max_size = 5` bounds what it could have done.

**One operational note worth recording.** The first attempt failed its
thresholds with 100% 429s. The prod rate limit is 200 requests per 15 minutes
per IP, and a load generator is one IP. Raising it by hand did not survive —
Argo CD reverted the ConfigMap mid-test, because a merge had just landed and
auto-sync applied git over the drift. Pausing `syncPolicy.automated` for the
duration is the correct procedure, and restoring it afterwards left the app
`OutOfSync` until an explicit sync, since `selfHeal: false` means Argo *detects*
drift without correcting it. Both behaviours are Phase 8 working exactly as
configured, observed rather than assumed.

### The EKS build — Terraform, IRSA, and what broke

`terraform/` builds the cluster from an empty AWS account in ~20 minutes and
`make destroy` removes it. 64 resources: VPC with public/private subnets across
two AZs and one NAT gateway, six ECR repositories, EKS 1.36, a managed node
group, five IAM roles, an ACM wildcard certificate, and a KMS key.

```bash
aws login --profile vesselmind
export AWS_PROFILE=vesselmind-tf          # see docs/EKS.md for why the -tf wrapper exists
terraform -chdir=terraform apply
make -C terraform destroy                  # when finished
```

#### IRSA, which is the point of the phase

Four workloads assume AWS roles through the cluster's OIDC provider rather than
sharing the node's identity:

| Workload | Role | What it does with it |
|---|---|---|
| EBS CSI driver | `vesselmind-ebs-csi` | Creates the gp3 volumes behind every PVC |
| AWS Load Balancer Controller | `vesselmind-lb-controller` | Turns Ingress objects into one shared ALB |
| Cluster Autoscaler | `vesselmind-cluster-autoscaler` | Resizes the node group's ASG |
| external-dns | `vesselmind-external-dns` | Writes Route 53 records from Ingress hosts |

The chain is: cluster publishes an OIDC issuer → `aws_iam_openid_connect_provider`
registers it in IAM → a role's trust policy pins `sub` to
`system:serviceaccount:<ns>:<name>` → the ServiceAccount is annotated → a webhook
injects `AWS_ROLE_ARN` and a projected token → the SDK calls
`AssumeRoleWithWebIdentity`.

**The `sub` condition is the part that matters.** Omit it and the role still
works — it is simply assumable by every pod in the cluster. Two of the four roles
are hand-written least-privilege (external-dns writes are scoped to one hosted
zone; the autoscaler can *see* every ASG but only *resize* ones tagged for this
cluster). The load balancer controller's is vendored upstream verbatim — 80
actions, 10 on `Resource: "*"` — and
[`terraform/policies/README.md`](terraform/policies/README.md) says plainly that
this is not least privilege, names the 13 actions that are dead weight here, and
explains why they are still present.

**A separate OIDC trust lets GitHub Actions push to ECR** with no stored AWS
keys — same mechanism, different issuer, `sub` pinned to
`repo:owner/name:ref:refs/heads/main` so a fork's pull request cannot obtain it.

#### At rest

Kubernetes Secrets are envelope-encrypted under a customer KMS key, and EBS
encryption is on by default account-wide. Both were **missing** on the first
build and found by reviewing the applied cluster rather than the code —
`encryptionConfig` was `null` and `get-ebs-encryption-by-default` returned
`False`, which meant the Postgres volume would have been plaintext with nothing
in `kubectl get pvc` making that visible. Sealing secrets in git while leaving
the in-cluster copy outside your own key boundary protects the repository and
stops there.

#### Nine bugs a laptop cluster could not surface

Six existed because Phases 1–6 built resources by hand *before* Argo CD arrived,
so nothing ever had to create its own preconditions. **The repo could not deploy
itself from an empty cluster**, and only rebuilding from nothing showed it.

| What broke | Why k3d hid it |
|---|---|
| `db-init` PreSync hook deadlocked — needs a ServiceAccount, Secret and database that are all Sync-phase | They already existed when Argo arrived |
| StorageClass blocked by **three** separate allow-lists, each failing differently | Dev overlay has no StorageClass |
| Argo could not create the `prometheus` ClusterRole (privilege escalation), which then **panicked the controller** | The role pre-existed, so Argo only *adopted* it |
| HPA synced before the Deployment it targets | Same wave ordering on both, but nothing forced the issue |
| A CronJob-only PVC blocked the sync forever under `WaitForFirstConsumer` | local-path binds immediately |
| Grafana's SealedSecret was never re-sealed for the new cluster | Same key on the same cluster |
| Pinned image digests **predated `/api/ready`**, so pods could never pass readiness | Images and manifests moved together locally |
| NetworkPolicy blocked the ALB | k3s CNI, and Traefik is an in-cluster pod |
| `/` is not a shared health endpoint — the API 404s on it | Traefik health-checks differently |

Two more were introduced by the EKS work itself: external-dns had a duplicate
`--txt-owner-id` flag *and* the wrong namespace in its trust policy — the crash
was hiding the subtler bug underneath it.

**The rule that falls out of four of these:** a resource must not sync earlier
than whatever its *health* depends on. Sync waves order the apply, and Argo gates
each wave on health, so a wave-0 resource whose health depends on wave 2 blocks
the sync permanently rather than transiently.

#### NetworkPolicy, finally proven

The best of the nine. The site returned **504 over a valid TLS endpoint while
every pod was `1/1 Ready`** — api and web target groups at `Target.Timeout`,
Grafana healthy in the one namespace with no NetworkPolicy.

The VPC CNI ignores NetworkPolicy unless `enableNetworkPolicy` is set, which
`terraform/addons.tf` does. With `target-type: ip` the ALB connects from its own
ENIs in the public subnets — not from a pod — so no `podSelector` or
`namespaceSelector` could match it and default-deny dropped the traffic, health
checks included.

This README previously listed enforcement as *configured but unproven*, drawing
the distinction that a policy configured to be enforced and one observed denying
traffic are different things. **This is the observation.** The fix is an
`ipBlock` scoped to the two public subnets — not the VPC, which would let every
node and pod reach the API directly.

#### Cost, and the teardown that actually works

~$0.28/hour: EKS control plane $0.10, three t3.medium $0.125, NAT gateway
$0.045, ALB and EBS the remainder. A full session costs $1–2.

`make destroy` deletes the Argo Applications, then the namespaces, and only then
runs `terraform destroy`. The order is not cosmetic: the ALB is created by a
controller in response to an Ingress, and the PVC volumes by the CSI driver in
response to a PVC — **neither is in Terraform state**. Destroying infrastructure
first strands a billing load balancer and hangs the VPC delete on its ENIs.
`make check-orphans` verifies afterwards rather than assuming.

One residual charge is expected and cannot be avoided: a KMS key enters a 7-day
pending-deletion window and bills ~$1/month until it goes, about $0.23. Seven
days is the AWS minimum.


### Observability

Prometheus and Grafana run in a `monitoring` namespace from hand-written
manifests — no operator, no Helm chart. The app already exposed
`http_request_duration_seconds` via `prom-client`; nothing consumed it until now.

Dashboard *VesselMind API*, four panels on one time axis: request rate, p95/p50
latency, ready replicas, and rate split by status code. Verified live under load:
361 req/s, p95 10 ms, 8 ready replicas, zero 429s.

**Prometheus discovers pods, not the Service.** Scraping a Service load-balances
across replicas, so each scrape lands on a random pod and no pod's counters are
ever complete. Per-pod discovery is also what makes `count(up)` usable as a
replica gauge — which is why there is no `kube-state-metrics` here.

Limits, deliberately: no operator so no `ServiceMonitor` CRDs and no bundled
alert rules; **no alerting at all**, which is the biggest gap; Prometheus storage
is an `emptyDir`; `/metrics` is unauthenticated; Grafana allows anonymous viewing.

### Backups, and a restore that was actually performed

A CronJob writes gzipped `pg_dump` output to a PVC daily. The restore was carried
out against this cluster, not written from memory:

```
1. Backup taken           -> 6,637 bytes, verified with gzip -t
2. DROP SCHEMA CASCADE    -> 0 tables
3. App response           -> {"error":"Database unavailable"}
4. Restore from archive   -> 3 vessels, 24 tables, 3 migrations
5. App                    -> working again
```

Recovery needed **no pod restart and no re-seed** — Prisma reconnects lazily, so
the pods never noticed. `_prisma_migrations` came back with the dump, so the
schema is correctly versioned rather than merely present.

Two steps that are easy to omit: the dump is verified with `gzip -t` before being
declared successful, because a truncated write produces a plausible-looking file
that fails only on restore day; and retention is enforced, because unbounded
backups fill the volume and then every *future* backup fails.

Full procedure and its limits — logical not physical backups, so no point-in-time
recovery — in [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md).

### Security and policy

- **Pod Security Standards at `restricted`, enforced.** Admission control rejects
  non-compliant pods outright. Getting there meant Postgres running as uid 70
  rather than root, the migration Job dropping root, the warehouse CronJob
  working from `/tmp`, and `seccompProfile: RuntimeDefault` everywhere.
- **NetworkPolicy, proven rather than assumed.** Enforcement is the CNI's job,
  not the API server's — plain flannel ignores these objects while they sit there
  looking authoritative. Measured with a probe pod, same command before and
  after: `REACHABLE` → `BLOCKED`, while every legitimate path kept working.
- **Per-workload ServiceAccounts with `automountServiceAccountToken: false`.**
  Every pod previously ran as `default` with a live Kubernetes API credential
  mounted that none of them used.
- **PodDisruptionBudgets**, demonstrated both ways: a normal drain rescheduled
  pods with the app answering 200 throughout, and an unsatisfiable budget made
  the same drain refuse with *"Cannot evict pod as it would violate the pod's
  disruption budget"*.
- **ResourceQuota + LimitRange**, tested by breaching them on purpose, and sized
  per environment against measured peak demand — `k8s/scripts/check-quota-headroom.py`
  renders an overlay, sums every workload at its maximum replica count (HPA
  `maxReplicas` where one exists, including LimitRange defaults for containers
  that declare no limits) and fails if peak exceeds the quota. It runs in CI.

  This caught a real bug: the prod overlay inherited the laptop-sized base quota,
  so its API HPA would have stopped scaling at 12 of its 20 replicas — reporting
  `desired: 20` while the ReplicaSet emitted `FailedCreate: exceeded quota` and
  pods silently never appeared. A quota below peak demand does not fail at apply
  time; it fails later, and looks like the autoscaler working.

### GitOps

Argo CD reconciles the cluster against `main`. Drift is **detected** continuously
and surfaced as `OutOfSync`; it is **not** auto-reverted, and that is a decision
rather than an omission.

`selfHeal` was on initially, and the drift demo worked exactly as advertised:

```
$ kubectl scale deployment/web --replicas=5
  immediately after manual change: 5 replicas
  REVERTED to 2 replicas after ~5s
```

It was then turned **off**, because selfHeal issues *partial* syncs that skip
`PreSync` hooks — so a self-heal could reconcile the application without ever
running the database migration that is supposed to gate it. Detecting drift and
fixing it deliberately is worth more than fixing it automatically past a safety
gate. The reasoning is in the comment on `automated.selfHeal` and the full story
in [docs/GITOPS.md](docs/GITOPS.md).

Two related decisions worth reading together:

- `spec.replicas` is **absent** from the API Deployment, and the Application sets
  `ignoreDifferences` on that path. The HPA owns the field; declaring it in git
  too meant two controllers writing one value, which under selfHeal became a real
  fight — the autoscaler scaling up and Argo reverting it.
- `db-init` is a `PreSync` hook with `hook-delete-policy: BeforeHookCreation`.
  Jobs are immutable, so re-applying a changed one fails the whole sync; deleting
  the previous hook first makes that structurally impossible rather than merely
  unlikely.

Push vs pull, the adoption gotcha (the first sync is not a no-op), and what is
still missing are in [docs/GITOPS.md](docs/GITOPS.md).

### Supply chain

CI builds every runtime image, scans it with Trivy (failing on fixable
HIGH/CRITICAL), and publishes to GHCR tagged with the **commit SHA, never
`:latest`** — so a running pod's image names the exact commit that built it and
rollback means deploying the previous SHA. Pull requests build and scan but never
push.

The scanner earned its place on first run: 12 vulnerable packages in the API
image, 33 in the web image including CRITICAL OpenSSL. Where a fix existed it was
applied; where none did — `sqlparse`, pinned below the patched release by
`dbt-core` — it is suppressed in a `.trivyignore` with a justification and a
re-check date. Details in [docs/IMAGES.md](docs/IMAGES.md).

### Bugs this migration found in the application

Running under Kubernetes surfaced real defects that Docker Compose never would:

- **Rate limiting was globally broken behind a proxy.** `TRUST_PROXY` was unset,
  so `req.ip` was Traefik's pod IP for every request and the per-IP limiter
  counted the entire internet into one bucket of 200 per 15 minutes.
- **Background work ran in every API replica.** Weather sync and the AIS consumer
  lived in `server.ts`, so at 8 replicas that was 8 concurrent syncs against the
  same external API writing the same rows. Now a single-replica worker.
- **No graceful shutdown.** `server.ts` had no `SIGTERM` handler, so Node exited
  immediately and every rollout severed in-flight requests.
- **Dev dependencies and unused tooling in runtime images** — npm in the API
  image, pip in the analytics image, both carrying their own vendored CVEs. An
  unused tool is better removed than patched.

### What is still missing

- **The EKS cluster is not running right now, by design.** It is a burst
  cluster: built from an empty account, exercised, destroyed. The app has served
  real traffic on it over a browser-trusted certificate at
  `vesselmind.ahmadhadi.org`, with Argo CD reconciling from this repository — but
  there is no permanently running cloud deployment to point a reviewer at, and
  standing one up costs ~$0.28/hour. What exists is the ability to recreate it in
  about 20 minutes with one command.
- **Image digests are still bumped by hand.** CI publishes
  `ghcr.io/amdhd/vesselai-*:<sha>` and pushes to ECR on every merge, but nothing
  writes the resulting digest back into the prod overlay. That gap bit for real:
  the pinned images predated `/api/ready`, so every API pod deployed and then
  failed readiness with a 404 on an endpoint the running image had never had.
  Argo CD Image Updater, or a CI step that commits the digest, closes it.
- **No alerting**, on either cluster — dashboards only, which is the largest
  observability gap.
- **Argo CD is not exposed publicly on EKS**, deliberately. It is the deployment
  control plane, protected by a generated default password; reached by
  `kubectl port-forward`. Publishing it needs the password rotated and SSO in
  front, not just an Ingress.
- **Cluster controllers are not under GitOps.** The load balancer controller,
  autoscaler and Sealed Secrets are applied at bootstrap. Adopting them would
  need Argo granted `kube-system` plus the ability to manage admission webhooks
  cluster-wide — a real walk-back of the least-privilege RBAC. On a permanent
  cluster the answer flips, under a separate AppProject; the reasoning is in
  [`docs/EKS.md`](docs/EKS.md).
- **Postgres storage is pinned to one availability zone, inherently.** An EBS
  volume cannot cross an AZ. The gp3 StorageClass uses
  `volumeBindingMode: WaitForFirstConsumer`, so the volume is created wherever
  the pod is first scheduled rather than in an arbitrary zone — that removes the
  "volume node affinity conflict" failure at *first* start. It does not survive
  a node loss: once the volume exists, the pod can only ever reschedule onto a
  node in that same AZ, so an AZ outage takes the database down until the AZ
  returns. This is the same shape as the local-path limitation on k3d, with a
  different mechanism. Real answers are RDS Multi-AZ (managed failover) or
  in-cluster replication via CloudNativePG; a StatefulSet plus an EBS volume is
  neither, and is not made into one by adding replicas.
- **No alerting**, only dashboards.
- **Image tags are pinned by hand**, so a deploy still means editing a manifest.
  Closing that loop needs Argo CD Image Updater or a CI step that commits the tag.
- **Postgres is in-cluster and single-replica.** A StatefulSet gives stable
  identity and storage, not replication. Production answer is RDS.
- `express-rate-limit` uses an in-process store, so the effective ceiling is
  `replicas x max` until a shared Redis store exists.

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
| *Run it where the customer runs it* | The same manifests deploy to k3d and to EKS built from an empty AWS account by Terraform — IRSA for per-pod IAM, an ALB with an ACM certificate, KMS-encrypted Secrets, GitOps reconciliation, and a teardown that removes what Terraform does not own ([Running on Kubernetes](#running-on-kubernetes)) |
| *Debug what you deployed* | Nine bugs the EKS rebuild surfaced that a laptop cluster could not — including a GitOps deadlock that meant the repo could not deploy itself from empty, and a NetworkPolicy that was only *proven* enforced when it returned 504 with every pod healthy |

## Roadmap (honest gaps)

Scoped, understood, and not yet built — I'd rather name these than imply they're done:

- **Cloud infrastructure as code — done, and it carried the app.** `terraform/` builds the cluster from an empty AWS account; `make destroy` tears it down in the order that actually works (namespaces first, so the controller-created ALB and PVC volumes are really deleted rather than orphaned and billing). The full stack ran on it behind an ACM certificate with Argo CD reconciling from git, and the nine bugs that surfaced are written up in [Running on Kubernetes](#running-on-kubernetes). What remains is closing the manual digest bump and adding alerting.
- **Pipeline orchestration.** The medallion build is run on demand (`load_bronze.py` → `dbt build`). Production would want a scheduler (Dagster or Airflow), incremental models instead of full refreshes, and freshness alerting on the gold tables.
- **Onboarding playbook.** A one-pager on how a new customer fleet gets connected, configured, and scoped for success — the deployment-motion half of the FDE job, not the code half.
- **Remaining fixtures.** Equipment telemetry, SIRE findings, port congestion, and voyage history are still generated data. Swapping them for a customer's SCADA feed or class-society exports is the same ingestion pattern the three live pipelines already prove.

Already shipped and covered above: CI on every PR (`.github/workflows/ci.yml` — backend, frontend, Angular, data platform, and build/scan/publish for all three runtime images), Trivy scanning that gates on fixable HIGH/CRITICAL, frontend component tests, backend route-integration tests, deployable production images, and the full Kubernetes deployment with autoscaling, observability, tested backups, enforced Pod Security Standards and GitOps reconciliation.

---

## License

MIT — see [LICENSE](LICENSE).
