"""Tenant-isolation tests for the analytics service.

test_auth.py proves WHO gets in. This file proves WHAT they see once inside,
which needs the opposite technique: those tests stub `query()` because they are
about the gate, but a stub cannot tell you whether a WHERE clause is right. So
these build a small but real DuckDB warehouse — same schemas, tables and columns
the endpoints read — and run the actual SQL against it.

The fixture holds two fleets plus one public vessel, arranged so that a leak
would be loud rather than subtle: fleet B's vessel has the LONGEST distance and
the LONGEST idle episode, so if scoping failed it would top both of fleet A's
leaderboards instead of hiding somewhere in the middle of a list.

Run from data-platform/:

    pytest api/test_tenant_isolation.py
"""
import time

import duckdb
import jwt
import pytest
from fastapi.testclient import TestClient

from api import main
from api.main import JWT_SECRET, app

client = TestClient(app)

#                mmsi         name          type         owner      nm/day  pings  idle min
VESSELS = [
    ("111000001", "ALPHA ONE",  "Cargo",     "fleet-a",  100.0,  3,  60),
    ("111000002", "ALPHA TWO",  "Tanker",    "fleet-a",   50.0,  2,  None),
    ("222000001", "BRAVO ONE",  "Passenger", "fleet-b", 1000.0,  7,  600),
    ("999000001", "PUBLIC ONE", "Fishing",   None,        10.0,  1,  45),
]

FLEET_A_NAMES = {"ALPHA ONE", "ALPHA TWO"}
FLEET_B_NAMES = {"BRAVO ONE"}
PUBLIC_NAMES = {"PUBLIC ONE"}


def _build_warehouse(path, vessels):
    """Create the subset of the warehouse the endpoints read, then fill it."""
    con = duckdb.connect(str(path))
    con.execute("create schema gold")
    con.execute("create schema silver")
    # Column types match the real models: MMSI is text throughout the warehouse.
    con.execute("""create table gold.dim_vessel (
        mmsi varchar, fleet_id varchar, vessel_name varchar, vessel_type_desc varchar)""")
    con.execute("""create table gold.fct_vessel_daily (
        mmsi varchar, activity_date date, ping_count integer,
        avg_speed_knots double, distance_nm double)""")
    con.execute("""create table gold.gold_vessel_idling (
        mmsi varchar, idle_start timestamp, idle_end timestamp,
        idle_minutes integer, avg_lat double, avg_lon double)""")
    con.execute("create table silver.silver_ais_positions (mmsi varchar)")
    for mmsi, name, vtype, owner, dist, pings, idle in vessels:
        con.execute("insert into gold.dim_vessel values (?, ?, ?, ?)", [mmsi, owner, name, vtype])
        con.execute("insert into gold.fct_vessel_daily values (?, date '2024-01-15', ?, 10.0, ?)",
                    [mmsi, pings, dist])
        for _ in range(pings):
            con.execute("insert into silver.silver_ais_positions values (?)", [mmsi])
        if idle is not None:
            con.execute(
                "insert into gold.gold_vessel_idling values "
                "(?, timestamp '2024-01-15 00:00', timestamp '2024-01-15 00:00' + to_minutes(?), ?, 29.7, -94.9)",
                [mmsi, idle, idle],
            )
    con.close()


@pytest.fixture
def warehouse(tmp_path, monkeypatch):
    path = tmp_path / "vesselmind.duckdb"
    _build_warehouse(path, VESSELS)
    monkeypatch.setattr(main, "DB_PATH", path)
    return path


def _token(fleet_id) -> str:
    return jwt.encode(
        {"id": "u1", "role": "fleet_manager", "fleetId": fleet_id,
         "exp": int(time.time()) + 600},
        JWT_SECRET,
        algorithm="HS256",
    )


def _get(path, fleet_id):
    r = client.get(f"/api/analytics/{path}", headers={"Authorization": f"Bearer {_token(fleet_id)}"})
    assert r.status_code == 200, r.text
    return r.json()


def _names(rows):
    return {row["vessel_name"] for row in rows}


# --- The guarantee: one fleet never sees another fleet's vessel ---------------

@pytest.mark.parametrize("path", ["top-vessels?limit=100", "idling?limit=500"])
def test_fleet_a_never_sees_fleet_b_vessels(warehouse, path):
    assert not _names(_get(path, "fleet-a")) & FLEET_B_NAMES


@pytest.mark.parametrize("path", ["top-vessels?limit=100", "idling?limit=500"])
def test_fleet_b_never_sees_fleet_a_vessels(warehouse, path):
    assert not _names(_get(path, "fleet-b")) & FLEET_A_NAMES


def test_each_fleet_sees_its_own_vessels_and_public_ones(warehouse):
    assert _names(_get("top-vessels?limit=100", "fleet-a")) == FLEET_A_NAMES | PUBLIC_NAMES
    assert _names(_get("top-vessels?limit=100", "fleet-b")) == FLEET_B_NAMES | PUBLIC_NAMES


def test_public_vessel_is_visible_to_a_fleet_that_owns_nothing(warehouse):
    # The other half of the model: unclaimed AIS is broadcast data, not a
    # tenant's, so scoping must not hide it. A fleet with no registered vessels
    # still sees the public picture, and only that.
    assert _names(_get("top-vessels?limit=100", "fleet-z")) == PUBLIC_NAMES


def test_vessel_types_do_not_reveal_another_fleets_vessel(warehouse):
    # A distribution chart leaks too: BRAVO ONE is the fixture's only Passenger
    # vessel, so a "Passenger: 1" bar on fleet A's page would disclose it even
    # though no row names it.
    types_a = {row["type"] for row in _get("vessel-types", "fleet-a")}
    assert types_a == {"Cargo", "Tanker", "Fishing"}
    assert "Passenger" not in types_a


def test_summary_kpis_are_scoped(warehouse):
    # Aggregates are where scoping is easiest to forget: no row is returned, so
    # nothing visibly "leaks", yet a whole-warehouse count still reports another
    # fleet's activity in total. Every KPI must move with the scope.
    a = _get("summary", "fleet-a")
    assert a["vessels"] == 3                  # ALPHA ONE, ALPHA TWO, PUBLIC ONE
    assert a["position_reports"] == 3 + 2 + 1
    assert a["total_distance_nm"] == 100 + 50 + 10
    assert a["idle_episodes"] == 2            # ALPHA ONE's and PUBLIC ONE's

    b = _get("summary", "fleet-b")
    assert b["vessels"] == 2
    assert b["position_reports"] == 7 + 1
    assert b["total_distance_nm"] == 1000 + 10
    assert b["idle_episodes"] == 2


def test_summary_of_an_empty_scope_keeps_its_numeric_contract(tmp_path, monkeypatch):
    # A warehouse where every vessel is owned elsewhere: this fleet's scope is
    # empty. sum() over no rows is NULL, but the frontend types these KPIs as
    # numbers — so counts and distance must come back 0, while the date range,
    # which genuinely does not exist, stays null.
    path = tmp_path / "owned.duckdb"
    _build_warehouse(path, [v for v in VESSELS if v[3] is not None])
    monkeypatch.setattr(main, "DB_PATH", path)

    s = _get("summary", "fleet-z")
    assert s["vessels"] == 0
    assert s["position_reports"] == 0
    assert s["total_distance_nm"] == 0
    assert s["idle_episodes"] == 0
    assert s["first_day"] is None and s["last_day"] is None
    assert _get("top-vessels", "fleet-z") == []
    assert _get("idling", "fleet-z") == []
    assert _get("vessel-types", "fleet-z") == []


# --- The tenant key is bound, typed, and required on every route --------------

def test_injection_shaped_fleet_id_is_treated_as_a_literal(warehouse):
    # The classic payload. Interpolated into the WHERE clause it would make the
    # predicate true for every row and expose both fleets; bound as a parameter
    # it is just a fleet id that owns nothing, so the caller sees public data.
    payload = "x' or d.fleet_id is not null or '1'='1"
    assert _names(_get("top-vessels?limit=100", payload)) == PUBLIC_NAMES
    assert _get("summary", payload)["vessels"] == 1


@pytest.mark.parametrize("bad_fleet_id", [["fleet-a", "fleet-b"], 1, {"id": "fleet-a"}, ""])
def test_non_string_fleet_claim_is_refused(warehouse, bad_fleet_id):
    # Truthy is not enough — a list or a number is not a tenant key. Refused at
    # the gate, before any query decides what such a value would mean.
    r = client.get(
        "/api/analytics/summary",
        headers={"Authorization": f"Bearer {_token(bad_fleet_id)}"},
    )
    assert r.status_code == 403


def _dependency_calls(dependant):
    for dep in dependant.dependencies:
        yield dep.call
        yield from _dependency_calls(dep)


def test_every_analytics_route_is_fleet_scoped():
    # Structural guard for the endpoint nobody has written yet. The behavioural
    # tests above cover the four routes that exist; this one fails the moment a
    # fifth is added without taking fleet_scope, instead of after it ships.
    routes = [r for r in app.routes if getattr(r, "path", "").startswith("/api/analytics/")]
    assert len(routes) >= 4, "route discovery matched nothing — the guard would pass vacuously"
    for route in routes:
        assert main.fleet_scope in set(_dependency_calls(route.dependant)), (
            f"{route.path} does not depend on fleet_scope"
        )
