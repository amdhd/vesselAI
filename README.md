# VesselMind AI — Maritime Fleet Intelligence Platform

AI-powered SaaS platform for oil & gas vessel fleet operators in Southeast Asia and the Middle East. Six intelligent modules powered by the Anthropic Claude API.

## Modules

| # | Module | Purpose |
|---|--------|---------|
| 1 | Voyage & Route Optimizer | Reduce fuel costs with AI-optimized routes |
| 2 | Predictive Maintenance | Detect equipment anomalies before failures |
| 3 | Emissions & Compliance | IMO CII, EU ETS, MRV reporting automation |
| 4 | Port Scheduling & ETA | Dynamic ETA prediction, demurrage prevention |
| 5 | Vessel Knowledge Assistant | AI troubleshooting chatbot for crew |
| 6 | SIRE Inspection Auto-Prep | Automate vetting inspection preparation |

## Tech Stack

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS + Recharts + Leaflet.js
- **Backend:** Node.js + Express + TypeScript + Prisma ORM
- **Database:** PostgreSQL 16
- **AI:** Anthropic Claude API (`claude-sonnet-4-6`)
- **Real-time:** Socket.io
- **Auth:** JWT

---

## Quick Start

### Prerequisites

- Node.js 20+
- Docker + Docker Compose
- Anthropic API key ([get one here](https://console.anthropic.com))

### 1. Clone & Configure

```bash
# Copy environment variables
cp .env.example .env

# Edit .env and add your Anthropic API key
nano .env
# Set: ANTHROPIC_API_KEY=sk-ant-api03-...
```

### 2. Start with Docker (Recommended)

```bash
# Start PostgreSQL + backend + frontend
docker compose up -d

# Run database migrations and seed demo data
docker compose exec backend npm run db:migrate
docker compose exec backend npm run db:seed
```

App will be available at: http://localhost:5173

### 3. Manual Setup (Alternative)

**Backend:**
```bash
cd backend
npm install
cp ../.env.example .env  # edit DATABASE_URL

# Start PostgreSQL separately, then:
npm run db:generate  # generate Prisma client
npm run db:migrate   # run migrations
npm run db:seed      # seed demo data
npm run dev          # start on port 3001
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev          # start on port 5173
```

---

## Demo Mode

Click **"Try Demo"** on the login page to auto-login as:
- **Name:** Captain Ahmad
- **Company:** Petronas Marine Sdn Bhd
- **Fleet:** 3 vessels (MV Merdeka Spirit, MT Kerteh Venture, OSV Tenaga Satu)

Pre-loaded demo scenarios:
- **Module 2:** Turbocharger bearing anomaly on MV Merdeka Spirit (4 days to failure)
- **Module 3:** MT Kerteh Venture CII at D rating (regulatory risk)
- **Module 4:** OSV Tenaga Satu approaching demurrage at Port Fujairah

All Claude AI features remain fully functional with your API key.

---

## API Routes

```
POST   /api/auth/login
POST   /api/auth/register

GET    /api/fleet
GET    /api/vessels/:id

# Module 1 — Voyage
POST   /api/voyage/optimize-route
GET    /api/voyage/history/:vesselId
POST   /api/voyage/calculate-speed
GET    /api/voyage/active/:fleetId
POST   /api/voyage/predict-eta
POST   /api/voyage/generate-agent-message

# Module 2 — Maintenance
GET    /api/maintenance/equipment/:vesselId
GET    /api/maintenance/sensor-data/:equipmentId
POST   /api/maintenance/analyze-anomaly
POST   /api/maintenance/work-order
GET    /api/maintenance/work-orders/:vesselId

# Module 3 — Compliance
GET    /api/compliance/cii/:vesselId
GET    /api/compliance/ets/:vesselId
POST   /api/compliance/generate-mrv-report
POST   /api/compliance/chat

# Module 4 — Ports
GET    /api/ports/congestion
POST   /api/voyage/predict-eta
POST   /api/voyage/generate-agent-message

# Module 5 — Knowledge
POST   /api/knowledge/chat
POST   /api/knowledge/upload-document
GET    /api/knowledge/documents/:vesselId
POST   /api/knowledge/generate-defect-report
POST   /api/knowledge/handover

# Module 6 — SIRE
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
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | Secret for JWT signing (min 64 chars) |
| `ANTHROPIC_API_KEY` | ✅ | Anthropic Claude API key |
| `FRONTEND_URL` | ✅ | Frontend URL for CORS |
| `STORMGLASS_API_KEY` | ❌ | Real weather data (mock used if absent) |
| `MARINETRAFFIC_API_KEY` | ❌ | Real AIS tracking (mock used if absent) |

---

## Cloud Deployment

### Deploy to Railway (Backend + Database)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up

# Set environment variables in Railway dashboard:
# ANTHROPIC_API_KEY, JWT_SECRET, FRONTEND_URL
```

### Deploy Frontend to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

cd frontend
vercel deploy

# Set in Vercel dashboard:
# VITE_API_URL = https://your-railway-app.railway.app/api
```

---

## Project Structure

```
├── frontend/               # React + Vite app
│   └── src/
│       ├── pages/          # Route-level pages
│       ├── components/     # Shared UI components
│       ├── modules/        # One folder per AI module
│       │   ├── voyage/
│       │   ├── maintenance/
│       │   ├── compliance/
│       │   ├── ports/
│       │   ├── knowledge/
│       │   └── sire/
│       ├── lib/            # API client, utils, types
│       ├── context/        # React contexts
│       └── hooks/          # Custom React hooks
├── backend/                # Express API
│   ├── src/
│   │   ├── routes/         # Express routers
│   │   ├── services/       # Claude API integration (shared prompt/JSON helpers)
│   │   ├── lib/            # Tenant isolation, fuel model, JWT config, prompt-injection guardrails
│   │   ├── middleware/     # Auth, error handling
│   │   └── mock/           # Mock data files (fleet/vessels are backed by Postgres when seeded; other domains are fixtures)
│   └── prisma/
│       ├── schema.prisma
│       └── seed.ts
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## License

MIT — Built with [Claude Code](https://claude.ai/claude-code) by Anthropic
