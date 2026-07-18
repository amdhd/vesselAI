# VesselMind Data Platform

A local, offline **medallion data pipeline** (bronze → silver → gold) that turns
raw AIS vessel-tracking data into analytics-ready tables and a dashboard.

It's the data-engineering companion to **VesselMind**, a maritime SaaS app.
Where the app captures operational data transactionally (Node.js + PostgreSQL),
this platform shows the *analytics* side: ingesting messy public AIS feeds,
cleaning them, modelling them into a star schema, and surfacing insight — the
raw-data-to-decision path a data platform is judged on.

Everything runs **offline on a laptop** (no cloud, no paid services).

> **Status:** All four phases (Bronze → Silver → Gold → Dashboard) complete,
> runnable, and tested — 25/25 dbt checks passing and a working Streamlit app.

---

## Architecture (medallion / bronze-silver-gold)

```
   NOAA AIS daily CSV                    DuckDB warehouse (data/vesselmind.duckdb)
  (17 cols, ~millions of        ┌───────────────────────────────────────────────────────┐
   rows/day, plenty of mess)    │                                                       │
        │                       │  BRONZE            SILVER              GOLD           │
        │   ingestion/          │  raw, as-is  ──►   cleaned & typed ──► star schema    │   Streamlit
        ▼   load_bronze.py      │  every col TEXT    dedup / filtered    dim + fact  ───┼──►  dashboard
  data/raw/*.csv  ───────────►  │  ais_positions_raw silver_ais_positions dim_vessel     │   (gold only)
                                │                                        fct_vessel_daily│
                                │  [ Phase 1 ✅ ]    [ Phase 2 ✅ dbt ]  [ Phase 3 ✅ dbt]│   [ Phase 4 ✅ ]
                                └───────────────────────────────────────────────────────┘
```

**Why medallion?** Each layer has exactly one responsibility, so problems are
easy to localize and every step is independently inspectable:

| Layer | Job | Rule of thumb |
|-------|-----|---------------|
| **Bronze** | Land the source data losslessly, exactly as it arrived | *Never* clean here — keep the mess so you can see it |
| **Silver** | Make it correct & usable: dedupe, type, validate, standardize | One clean, trustworthy row per real event |
| **Gold**   | Make it useful: business aggregates & star schema for analytics | Shaped for the question, not the source |

**Gold layer (Phase 3)** is a small **star schema** — `dim_vessel` (one descriptive
row per vessel) + `fct_vessel_daily` (per-vessel-per-day measures: pings, speed,
estimated distance, first/last position) — plus a business model,
`gold_vessel_idling`, which uses a *gaps-and-islands* SQL pattern to detect
vessels sitting near-stationary for extended periods (fuel burn / port congestion).

---

## Stack & why

| Tool | Role | Why this one |
|------|------|--------------|
| **DuckDB** | The warehouse engine (an embedded OLAP database, "SQLite for analytics") | Zero setup — it's just a file. Reads CSVs directly and processes data larger than RAM, so a full daily file loads fine on 16GB. |
| **dbt Core** (+ dbt-duckdb) | Transform bronze → silver → gold in SQL | Industry-standard for versioned, tested, documented SQL transformations. *(Phase 2)* |
| **Python 3.10** | The ingestion loader | Simple, and the venv is pinned to 3.10 because dbt does not yet support 3.14. |
| **Streamlit** | The dashboard | Turns gold tables into a UI in ~100 lines, no frontend build. *(Phase 4)* |

---

## Quickstart

```bash
cd data-platform             # this project lives inside the vesselAI repo

# 1) Create the environment (Python 3.10 — see note above)
python3.10 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 2) Get some data (pick one)
#    a) Quick demo — synthetic sample with realistic AIS "mess" baked in:
python notebooks_or_scripts/generate_sample_ais.py
#    b) Real data — download one NOAA AIS daily file (see "Getting real data")
#       and drop the .csv into data/raw/

# 3) Land it in the bronze layer
python ingestion/load_bronze.py

# 4) Explore the raw data and find the mess (before we clean it in Phase 2)
#    Option A (nicest) — DuckDB CLI:
#        brew install duckdb
#        duckdb data/vesselmind.duckdb ".read notebooks_or_scripts/explore.sql"
#    Option B — no extra install, run a single query with the venv:
#        python -c "import duckdb; c=duckdb.connect('data/vesselmind.duckdb'); \
#          print(c.sql('select count(*) rows, count(distinct MMSI) vessels from bronze.ais_positions_raw'))"

# 5) Build & test SILVER + GOLD with dbt (clean, model the star schema, test)
cd dbt
../.venv/bin/dbt build --profiles-dir .   # builds silver + gold, runs all 25 data tests
cd ..

# 6) Launch the dashboard (its own venv — see "Dashboard" below for why)
python3.10 -m venv .venv-dashboard
source .venv-dashboard/bin/activate
pip install -r requirements-dashboard.txt
streamlit run dashboard.py                # opens http://localhost:8501
```

### Getting real data (NOAA MarineCadastre AIS)

1. Go to **https://marinecadastre.gov/ais/**
2. Download **one daily zip** — e.g. `AIS_2024_01_01.zip` (any single day is
   plenty). Each zip is one CSV with these 17 columns: `MMSI, BaseDateTime,
   LAT, LON, SOG, COG, Heading, VesselName, IMO, CallSign, VesselType, Status,
   Length, Width, Draft, Cargo, TransceiverClass`.
3. Unzip it and put the `.csv` in **`data/raw/`**.
4. Re-run `python ingestion/load_bronze.py` — it loads every CSV in `data/raw/`.

*(The included `data/raw/ais_sample.csv` uses this exact schema, so the same
code runs on both.)*

### Data scale

The committed `ais_sample.csv` is **deliberately small (~2.4k rows)** so the repo
runs instantly offline and the injected data-quality issues are easy to count in
`explore.sql`. It is *not* the target scale.

Real NOAA daily files are **5–12 million rows**, and nothing in the code assumes
small data: the loader streams the CSV off disk (never into pandas) and the dbt
transforms are just SQL. To prove it, generate a large synthetic file and run the
same pipeline:

```bash
# ~1.5 million rows -> data/ais_large.csv
python notebooks_or_scripts/generate_sample_ais.py --vessels 1000 --step-min 1 --out data/ais_large.csv
python ingestion/load_bronze.py --csv data/ais_large.csv
cd dbt && dbt build --profiles-dir . && cd ..
```

Measured on a MacBook Air (16GB): **1.48M rows loaded in ~1.3s, and dedup +
validation + 8 tests in ~3.4s.** DuckDB is built for this.

> **Tip — "why does dbt only show a few rows?"** dbt builds a *table in the
> warehouse* and prints a status summary (`1 of 9 … PASS=9` = models + tests,
> not data rows). `dbt show` prints a 5-row *preview*. To see the real row count,
> query it: `duckdb data/vesselmind.duckdb "select count(*) from silver.silver_ais_positions"`.

---

## Dashboard (Phase 4)

A small Streamlit app that reads **only the gold tables** and shows: KPI tiles
(vessels, position reports, distance, idle episodes), a **map** of each vessel's
latest position, a **bar chart** of distance travelled per vessel, and the
**idling report** table. A sidebar filters by vessel type.

```bash
python3.10 -m venv .venv-dashboard && source .venv-dashboard/bin/activate
pip install -r requirements-dashboard.txt
streamlit run dashboard.py    # http://localhost:8501
```

**Why a separate venv?** Streamlit and dbt pin incompatible versions of shared
packages (e.g. protobuf 7 vs 6), so they can't share one environment. The
dashboard only needs to *read* gold (duckdb), not transform it (dbt) — so
`.venv-dashboard` holds just `streamlit` + `duckdb`. Keeping the app environment
separate from the transform environment is also normal practice.

---

## Serving layer — Fleet Analytics API (app integration)

The gold tables also power a **Fleet Analytics** page *inside the VesselMind app*
(not only the standalone Streamlit dashboard). A tiny read-only FastAPI service
(`api/main.py`) exposes gold as JSON, and the React app renders it with its own
components. The app never touches the millions of raw rows — it reads only the
small, pre-aggregated gold results.

```
gold (DuckDB)  ──►  FastAPI  api/main.py (:8000)  ──►  React "Fleet Analytics" page
                    /api/analytics/{summary,vessel-types,top-vessels,idling}
```

Run the API (from `data-platform/`, after building the warehouse with dbt):

```bash
pip install -r api/requirements.txt        # into .venv, or its own venv
uvicorn api.main:app --port 8000
```

The frontend points at it via `VITE_ANALYTICS_API_URL` (default
`http://localhost:8000`). Every endpoint is aggregated / top-N, so responses stay
small no matter how big the raw feed is.

---

## Layout

```
data-platform/                   # (subfolder of the vesselAI repo)
├── README.md
├── requirements.txt
├── data/
│   ├── raw/                     # NOAA CSV(s) go here (sample included)
│   └── vesselmind.duckdb        # the warehouse (created by the loader)
├── ingestion/
│   └── load_bronze.py           # raw CSV -> DuckDB bronze schema, untouched
├── dbt/                         # silver + gold transformations   (Phase 2–3)
│   ├── dbt_project.yml
│   ├── profiles.yml             # duckdb target -> data/vesselmind.duckdb
│   ├── models/
│   │   ├── bronze/              # source declaration only (raw stays untouched)
│   │   ├── silver/              # silver_ais_positions.sql + tests
│   │   └── gold/                # dim_vessel, fct_vessel_daily, gold_vessel_idling
│   ├── macros/                  # `between` test, schema naming, haversine distance
│   └── tests/                   # singular tests: unique grains (silver ping, daily fact)
├── notebooks_or_scripts/
│   ├── generate_sample_ais.py   # optional: make the demo sample
│   └── explore.sql              # queries to inspect each layer
├── dashboard.py                 # Streamlit app over gold tables   (Phase 4)
└── requirements-dashboard.txt   # dashboard deps (installed in .venv-dashboard)
```

---

## Roadmap

- [x] **Phase 1 — Bronze:** raw AIS CSV landed in DuckDB, as-is, plus queries to surface data-quality problems.
- [x] **Phase 2 — Silver (dbt):** dedupe on `(MMSI, BaseDateTime)`, validate coordinates, cast types, drop rows with no MMSI; 8 dbt tests passing.
- [x] **Phase 3 — Gold (dbt):** star schema (`dim_vessel`, `fct_vessel_daily`) + `gold_vessel_idling` (idle-episode detection via gaps-and-islands); 21 gold-layer dbt checks passing.
- [x] **Phase 4 — Dashboard:** Streamlit app (separate venv) reading only gold tables — KPIs, vessel map, distance chart, idling report.
