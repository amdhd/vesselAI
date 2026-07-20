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

import os
from pathlib import Path

import duckdb
import jwt
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "vesselmind.duckdb"

# Verify the SAME JWT the Express backend issues (HS256, signed with JWT_SECRET),
# so this service inherits the app's auth instead of being an open data endpoint.
# The dev fallback mirrors backend/src/lib/jwtConfig.ts so local dev works out of
# the box; in production set JWT_SECRET to the exact value the API signs tokens with.
JWT_SECRET = os.environ.get("JWT_SECRET") or "vesselmind-dev-only-insecure-secret"

# Restrict CORS to the app origin(s). Override with ANALYTICS_ALLOWED_ORIGINS
# (comma-separated) in production; defaults to the local Vite dev + preview ports.
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "ANALYTICS_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:4173"
    ).split(",")
    if o.strip()
]

app = FastAPI(title="VesselMind Analytics API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["Authorization", "Content-Type"],
)

_bearer = HTTPBearer(auto_error=False)


def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> None:
    """Reject any request without a valid app-issued JWT.

    Runs as a route dependency before the query functions, so an unauthenticated
    caller never reaches DuckDB. A token minted by the Express /api/auth/login
    endpoint is accepted here unchanged because both sides share JWT_SECRET.
    """
    if credentials is None:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    try:
        jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


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


@app.get("/api/analytics/summary", dependencies=[Depends(require_auth)])
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


@app.get("/api/analytics/vessel-types", dependencies=[Depends(require_auth)])
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


@app.get("/api/analytics/top-vessels", dependencies=[Depends(require_auth)])
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


@app.get("/api/analytics/idling", dependencies=[Depends(require_auth)])
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
