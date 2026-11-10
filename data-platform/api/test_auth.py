"""Auth tests for the analytics service.

These exercise the JWT gate without a DuckDB file: unauthenticated requests are
rejected before `query()` runs, and the one valid-token case stubs `query()` so
it verifies auth + wiring rather than the warehouse. Run from data-platform/:

    pip install -r api/requirements.txt httpx pytest
    pytest api/test_auth.py
"""
import time

import jwt
import pytest
from fastapi.testclient import TestClient

from api import main
from api.main import JWT_SECRET, app

client = TestClient(app)

# Pass as a claim value to leave that claim out of the token entirely.
OMIT = object()


def _token(secret: str = JWT_SECRET, **claims) -> str:
    # Mirrors what the Express /api/auth/login endpoint mints: a fleet member
    # with an expiry. This helper used to set no exp at all, and
    # test_valid_token_passes_auth asserted 200 on it, so the suite was pinning
    # down "a never-expiring token is accepted" as correct behaviour.
    # Override any claim (e.g. fleetId=None) to exercise the gate, or pass OMIT
    # to drop it.
    payload = {
        "id": "u1",
        "email": "demo@petronas.com",
        "role": "fleet_manager",
        "fleetId": "fleet-001",
        "exp": int(time.time()) + 600,
    }
    payload.update(claims)
    payload = {k: v for k, v in payload.items() if v is not OMIT}
    return jwt.encode(payload, secret, algorithm="HS256")


def test_health_is_open():
    # Liveness check stays reachable without a token.
    assert client.get("/health").status_code == 200


def test_analytics_requires_token():
    assert client.get("/api/analytics/summary").status_code == 401
    assert client.get("/api/analytics/vessel-types").status_code == 401
    assert client.get("/api/analytics/top-vessels").status_code == 401
    assert client.get("/api/analytics/idling").status_code == 401


def test_analytics_rejects_malformed_token():
    r = client.get(
        "/api/analytics/summary",
        headers={"Authorization": "Bearer not-a-real-jwt"},
    )
    assert r.status_code == 401


def test_analytics_rejects_token_signed_with_wrong_secret():
    forged = _token(secret="a-different-secret-entirely")
    r = client.get(
        "/api/analytics/summary",
        headers={"Authorization": f"Bearer {forged}"},
    )
    assert r.status_code == 401


def test_analytics_rejects_token_without_a_fleet():
    # A self-service registrant gets fleetId: null (backend/src/routes/auth.ts).
    # It must not reach a warehouse holding every fleet's vessels, even though
    # its token is correctly signed.
    token = _token(fleetId=None)
    r = client.get(
        "/api/analytics/summary",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


def test_valid_token_passes_auth(monkeypatch):
    # Stub the DB layer so this verifies the auth gate + routing, not DuckDB.
    monkeypatch.setattr(main, "query", lambda sql, params=None: [{"vessels": 3}])
    r = client.get(
        "/api/analytics/summary",
        headers={"Authorization": f"Bearer {_token()}"},
    )
    assert r.status_code == 200
    assert r.json()["vessels"] == 3


def test_analytics_rejects_token_without_expiry():
    # Correctly signed and fleet-bearing, but with no exp. PyJWT checks exp
    # only when present, so this verified (and never expired) until the gate
    # required the claim.
    r = client.get(
        "/api/analytics/summary",
        headers={"Authorization": f"Bearer {_token(exp=OMIT)}"},
    )
    assert r.status_code == 401


def test_analytics_rejects_expired_token():
    r = client.get(
        "/api/analytics/summary",
        headers={"Authorization": f"Bearer {_token(exp=int(time.time()) - 10)}"},
    )
    assert r.status_code == 401
