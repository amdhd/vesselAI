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

REPO_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = REPO_ROOT / "data-platform" / "data" / "vesselmind.duckdb"

# The dev-only fallback mirrors backend/src/lib/jwtConfig.ts.
DEV_FALLBACK_SECRET = "vesselmind-dev-only-insecure-secret"


def _secret_from_backend_env() -> str | None:
    """Read JWT_SECRET out of backend/.env, if that file sets one.

    Lets `uvicorn api.main:app` (any launcher — CLI, launch.json, a script)
    verify the exact tokens the Express backend signs without the caller having
    to export the secret first. Env var still wins, so production/CI can override.
    A tiny hand-rolled parser avoids adding a python-dotenv dependency.
    """
    env_path = REPO_ROOT / "backend" / ".env"
    if not env_path.exists():
        return None
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line.startswith("JWT_SECRET="):
            return line.split("=", 1)[1].strip().strip("'\"") or None
    return None


def _resolve_jwt_secret() -> str:
    """Env var > backend/.env > dev-only fallback.

    So this service inherits the app's auth instead of being an open data
    endpoint. In production set JWT_SECRET explicitly to the value tokens are
    signed with; locally it self-resolves from backend/.env.
    """
    explicit = os.environ.get("JWT_SECRET") or _secret_from_backend_env()
    if explicit:
        # A short secret is treated as no secret, mirroring backend/src/lib/jwtConfig.ts.
        # Without this the two services disagree: Express refuses to boot on a weak
        # JWT_SECRET while analytics would still verify tokens signed with it.
        if len(explicit) < 32:
            if os.environ.get("NODE_ENV") == "production":
                raise RuntimeError(
                    f"JWT_SECRET is too short ({len(explicit)} chars, min 32). "
                    "Refusing to start in production."
                )
            return DEV_FALLBACK_SECRET
        return explicit

    # No real secret found. Mirror backend/src/lib/jwtConfig.ts, which refuses to
    # fall back to a hardcoded secret in production — otherwise a prod deploy that
    # forgot JWT_SECRET (and has no backend/.env alongside it, the normal case for
    # a separately-deployed service) would verify forged tokens against a
    # publicly-known value, leaving the analytics data effectively unauthenticated.
    if os.environ.get("NODE_ENV") == "production":
        raise RuntimeError(
            "JWT_SECRET is not set and no backend/.env was found. Refusing to "
            "start in production with the insecure dev-only fallback secret."
        )
    return DEV_FALLBACK_SECRET


JWT_SECRET = _resolve_jwt_secret()

# The claim contract — MUST match JWT_ISSUER / JWT_ANALYTICS_AUDIENCE in
# backend/src/lib/jwtConfig.ts, which signs every token this service accepts.
# If they drift, every analytics call 401s; test_auth.py pins these values so a
# one-sided change fails here rather than in production.
#
# The audience is the ANALYTICS one, not the login token's. This service has no
# connection to Postgres, so it cannot check whether a login token's session has
# since been revoked, or whether the user's fleet has changed. It accepts only
# the 5-minute token the backend issues from POST /api/auth/analytics-token,
# which the backend hands out only after that live check passes. So revocation
# and fleet changes reach this service within 5 minutes, not the 7 days a login
# token lives. A login token presented here is refused.
JWT_ISSUER = "vesselmind-api"
JWT_AUDIENCE = "vesselmind-analytics"

# Restrict CORS to the app origin(s). Override with ANALYTICS_ALLOWED_ORIGINS
# (comma-separated) in production; defaults to the local Vite dev + preview ports.
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "ANALYTICS_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:4173"
    ).split(",")
    if o.strip()
]

# Interactive docs are served without passing through require_auth — they are
# route dependencies, not app middleware — so leaving them on publishes the full
# endpoint/parameter schema to anonymous callers. Nothing consumes them.
app = FastAPI(
    title="VesselMind Analytics API",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["Authorization", "Content-Type"],
)

_bearer = HTTPBearer(auto_error=False)


def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    """Reject any request without a valid app-issued JWT that carries a fleet.

    Runs as a route dependency before the query functions, so an unauthenticated
    caller never reaches DuckDB. The token is the short-lived analytics token
    the Express backend issues from POST /api/auth/analytics-token (see
    JWT_AUDIENCE above), verified with the shared JWT_SECRET.

    A valid signature is not enough on its own. The Express API scopes every
    read to the caller's fleet and treats "no fleet" as "no access"
    (backend/src/lib/tenant.ts). A self-service registrant is created with
    fleetId: null, so without also requiring the claim, anyone who signs up
    could read the warehouse through this endpoint. Requiring it keeps this
    service's gate consistent with the app's model.

    The claim must be a non-empty STRING, not merely truthy. It is bound into
    every query as the tenant key (see fleet_scope), and `["fleet-a",
    "fleet-b"]` or `1` are truthy too. A bound parameter cannot be injected
    into, but a list or number is still the wrong key — the type check refuses
    it here rather than leaving each query to decide what such a value means.
    """
    if credentials is None:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    try:
        # require exp: PyJWT validates exp only when the token carries one, so
        # without this a token signed with no expiry is accepted forever. iss
        # and aud are required and checked for the same reason as in Express:
        # the secret proves who could have signed a token, not what it is for.
        claims = jwt.decode(
            credentials.credentials, JWT_SECRET, algorithms=["HS256"],
            issuer=JWT_ISSUER, audience=JWT_AUDIENCE,
            options={"require": ["exp", "iss", "aud"]},
        )
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    fleet_id = claims.get("fleetId")
    if not isinstance(fleet_id, str) or not fleet_id:
        raise HTTPException(status_code=403, detail="Analytics requires a fleet assignment")
    return claims


def fleet_scope(claims: dict = Depends(require_auth)) -> str:
    """The caller's fleet id — the tenant key every query below is scoped by.

    TENANCY MODEL. A vessel is visible to a fleet when that fleet owns it, or
    when no fleet does. Ownership comes from the registry seed
    (dbt/seeds/vessel_fleet_registry.csv) via gold.dim_vessel.fleet_id:

      fleet_id = <caller's fleet>  -> theirs: visible
      fleet_id IS NULL             -> public AIS broadcast: visible to any fleet
      fleet_id = <another fleet>   -> another tenant's vessel: NEVER visible

    Public stays visible on purpose. AIS is broadcast in the clear by every
    vessel over 300 GT, so hiding unclaimed vessels would protect nothing and
    blank the page — the same call the live AIS map makes (README: "gate the
    surface, not fake the data"). What this service must guarantee is the third
    line: a vessel one fleet owns never reaches another.

    Every query takes this value as a BOUND parameter, never interpolated.
    """
    return claims["fleetId"]


# The visibility rule above, as SQL over dim_vessel aliased `d`. One definition
# so the four endpoints cannot drift apart — a rule restated four times is a
# rule that eventually differs in one of them. It holds a placeholder, not the
# value: the caller still binds fleet_id as a parameter.
VISIBLE_TO_FLEET = "(d.fleet_id = ? or d.fleet_id is null)"


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
    # Unauthenticated by design (probes hit it), so it says only whether the
    # service is up — the existence of a file on the host is not the prober's
    # business and is exactly the kind of detail worth not publishing.
    return {"status": "ok"}


@app.get("/api/analytics/summary")
def summary(fleet_id: str = Depends(fleet_scope)):
    """Top-line KPIs over the vessels this fleet may see (a single row).

    Every sub-select is scoped, including the raw position count from silver —
    a KPI computed over the whole warehouse would report another fleet's
    activity in aggregate even with each row hidden. The scope is computed once
    in `visible` and bound once.
    """
    return query(
        f"""
        with visible as (
            select d.mmsi from gold.dim_vessel d where {VISIBLE_TO_FLEET}
        )
        select
            (select count(*) from visible)                                         as vessels,
            (select count(*) from silver.silver_ais_positions
              where mmsi in (select mmsi from visible))                            as position_reports,
            -- coalesce: sum() over no rows is NULL, and the contract is a number.
            (select coalesce(round(sum(distance_nm)), 0) from gold.fct_vessel_daily
              where mmsi in (select mmsi from visible))                            as total_distance_nm,
            (select count(*) from gold.gold_vessel_idling
              where mmsi in (select mmsi from visible))                            as idle_episodes,
            (select min(activity_date) from gold.fct_vessel_daily
              where mmsi in (select mmsi from visible))                            as first_day,
            (select max(activity_date) from gold.fct_vessel_daily
              where mmsi in (select mmsi from visible))                            as last_day
        """,
        [fleet_id],
    )[0]


@app.get("/api/analytics/vessel-types")
def vessel_types(fleet_id: str = Depends(fleet_scope)):
    """Vessel count by decoded type — for a distribution chart."""
    return query(
        f"""
        select d.vessel_type_desc as type, count(*) as vessels
        from gold.dim_vessel d
        where {VISIBLE_TO_FLEET}
        group by 1
        -- Tiebreak on the label: three types share a count in the sample, and
        -- ordering on the count alone let their bars swap between requests.
        order by 2 desc, 1
        """,
        [fleet_id],
    )


@app.get("/api/analytics/top-vessels")
def top_vessels(
    limit: int = Query(15, ge=1, le=100),
    fleet_id: str = Depends(fleet_scope),
):
    """The busiest vessels by estimated distance travelled."""
    return query(
        f"""
        select d.vessel_name, d.vessel_type_desc,
               f.distance_nm, f.avg_speed_knots, f.ping_count
        from gold.fct_vessel_daily f
        join gold.dim_vessel d using (mmsi)
        where d.vessel_name is not null
          and {VISIBLE_TO_FLEET}
        order by f.distance_nm desc, d.vessel_name, f.activity_date
        limit ?
        """,
        [fleet_id, limit],
    )


@app.get("/api/analytics/idling")
def idling(
    limit: int = Query(25, ge=1, le=500),
    fleet_id: str = Depends(fleet_scope),
):
    """Longest idle episodes (near-zero speed for an extended period).

    The scope matters most here: an idle episode carries a position (avg_lat /
    avg_lon) and a time window, which together say where a vessel waited and
    for how long — exactly the operational detail an owner would not want a
    competitor reading.
    """
    return query(
        f"""
        select d.vessel_name, d.vessel_type_desc,
               i.idle_start, i.idle_end, i.idle_minutes, i.avg_lat, i.avg_lon
        from gold.gold_vessel_idling i
        join gold.dim_vessel d using (mmsi)
        where {VISIBLE_TO_FLEET}
        order by i.idle_minutes desc, d.vessel_name, i.idle_start
        limit ?
        """,
        [fleet_id, limit],
    )
