"""
VesselMind Analytics API — the "serving layer" for Option B.

A tiny read-only FastAPI service that exposes the GOLD tables from the DuckDB
warehouse as JSON, so the React app can render a Fleet Analytics page without
ever touching the millions of raw rows. Every query is aggregated or top-N, so
responses stay small no matter how big the raw feed is (7M rows -> a few KB).

Data flow:  NOAA CSV -> bronze -> silver -> gold (DuckDB)  ->  THIS API  ->  React

Run (from the data-platform/ directory):
    uvicorn api.main:app --port 8000
"""

from pathlib import Path

import duckdb
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "vesselmind.duckdb"

app = FastAPI(title="VesselMind Analytics API", version="1.0.0")

# Dev CORS: let the Vite frontend (any localhost port) call us. In production
# you'd restrict this to the app's origin and put it behind the same auth/proxy.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def query(sql: str, params: list | None = None) -> list[dict]:
    """Run a read-only query against gold and return dict rows.

    A fresh read_only connection per request is safe — DuckDB allows many
    concurrent readers — and never blocks the dbt job that writes the file.
    """
    con = duckdb.connect(str(DB_PATH), read_only=True)
    try:
        cur = con.execute(sql, params or [])
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        con.close()


@app.get("/health")
def health():
    return {"status": "ok", "db_exists": DB_PATH.exists()}


@app.get("/api/analytics/summary")
def summary():
    """Top-line KPIs for the whole dataset (a single row)."""
    return query(
        """
        select
            (select count(*) from gold.dim_vessel)                      as vessels,
            (select count(*) from silver.silver_ais_positions)          as position_reports,
            (select round(sum(distance_nm)) from gold.fct_vessel_daily)  as total_distance_nm,
            (select count(*) from gold.gold_vessel_idling)              as idle_episodes,
            (select min(activity_date) from gold.fct_vessel_daily)       as first_day,
            (select max(activity_date) from gold.fct_vessel_daily)       as last_day
        """
    )[0]


@app.get("/api/analytics/vessel-types")
def vessel_types():
    """Vessel count by decoded type — for a distribution chart."""
    return query(
        """
        select vessel_type_desc as type, count(*) as vessels
        from gold.dim_vessel
        group by 1
        order by 2 desc
        """
    )


@app.get("/api/analytics/top-vessels")
def top_vessels(limit: int = Query(15, ge=1, le=100)):
    """The busiest vessels by estimated distance travelled."""
    return query(
        """
        select d.vessel_name, d.vessel_type_desc,
               f.distance_nm, f.avg_speed_knots, f.ping_count
        from gold.fct_vessel_daily f
        join gold.dim_vessel d using (mmsi)
        where d.vessel_name is not null
        order by f.distance_nm desc
        limit ?
        """,
        [limit],
    )


@app.get("/api/analytics/idling")
def idling(limit: int = Query(25, ge=1, le=500)):
    """Longest idle episodes (near-zero speed for an extended period)."""
    return query(
        """
        select d.vessel_name, d.vessel_type_desc,
               i.idle_start, i.idle_end, i.idle_minutes, i.avg_lat, i.avg_lon
        from gold.gold_vessel_idling i
        join gold.dim_vessel d using (mmsi)
        order by i.idle_minutes desc
        limit ?
        """,
        [limit],
    )
