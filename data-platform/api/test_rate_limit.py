"""Per-user rate limit on the analytics API (review item #7).

Runs the real limiter in front of the real routes, with the query layer stubbed
so these count requests, not warehouse work, and with the module clock pinned
so a window can be advanced without sleeping.
"""
import time

import jwt
import pytest
from fastapi.testclient import TestClient

from api import main

client = TestClient(main.app)
LIMIT = main.ANALYTICS_RATE_LIMIT


@pytest.fixture
def clock(monkeypatch):
    now = {"t": 1_000.0}
    monkeypatch.setattr(main, "_now", lambda: now["t"])
    return now


@pytest.fixture
def queries(monkeypatch):
    calls = []

    def fake_query(sql, params=None):
        calls.append(sql)
        return [{"vessels": 1}]

    monkeypatch.setattr(main, "query", fake_query)
    return calls


def _token(user_id: str) -> str:
    return jwt.encode(
        {"id": user_id, "role": "fleet_manager", "fleetId": "fleet-001",
         "exp": int(time.time()) + 600, "iss": main.JWT_ISSUER, "aud": main.JWT_AUDIENCE},
        main.JWT_SECRET, algorithm="HS256",
    )


def _summary(user_id: str):
    return client.get("/api/analytics/summary", headers={"Authorization": f"Bearer {_token(user_id)}"})


def test_allows_the_limit_then_refuses_with_retry_after(clock, queries):
    for _ in range(LIMIT):
        assert _summary("u1").status_code == 200
    clock["t"] += 15  # a quarter of the way through the window
    r = _summary("u1")
    assert r.status_code == 429
    assert r.headers["Retry-After"] == "45"


def test_a_refused_request_never_reaches_the_warehouse(clock, queries):
    for _ in range(LIMIT):
        _summary("u1")
    before = len(queries)
    assert _summary("u1").status_code == 429
    assert len(queries) == before


def test_one_users_limit_does_not_affect_another(clock, queries):
    for _ in range(LIMIT + 1):
        _summary("u1")
    assert _summary("u1").status_code == 429
    assert _summary("u2").status_code == 200


def test_the_limit_resets_when_the_window_ends(clock, queries):
    for _ in range(LIMIT):
        _summary("u1")
    # Limited first, or the 200 below would prove nothing.
    assert _summary("u1").status_code == 429
    clock["t"] += main.ANALYTICS_RATE_WINDOW_S
    assert _summary("u1").status_code == 200


def test_unauthenticated_requests_are_refused_before_the_limiter(clock, queries):
    # 401 at token decode: an anonymous flood never touches the counters or
    # the warehouse.
    for _ in range(LIMIT + 5):
        assert client.get("/api/analytics/summary").status_code == 401
    assert queries == []


def test_memory_is_bounded():
    limiter = main.FixedWindowLimiter(limit=1, window_s=60, max_keys=100)
    for i in range(1_000):
        limiter.hit(f"user-{i}", now=0.0)
    assert len(limiter._windows) == 100


def _dependency_calls(dependant):
    for dep in dependant.dependencies:
        yield dep.call
        yield from _dependency_calls(dep)


def test_every_analytics_route_is_rate_limited():
    # Structural guard, like the tenancy one: a new endpoint that skips the
    # limiter fails here rather than in production.
    routes = [r for r in main.app.routes if getattr(r, "path", "").startswith("/api/analytics/")]
    assert len(routes) >= 4
    for route in routes:
        assert main.rate_limited in set(_dependency_calls(route.dependant)), route.path
