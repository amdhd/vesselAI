"""Auth tests for the analytics service.

These exercise the JWT gate without a DuckDB file: unauthenticated requests are
rejected before `query()` runs, and the one valid-token case stubs `query()` so
it verifies auth + wiring rather than the warehouse. Run from data-platform/:

    pip install -r api/requirements.txt httpx pytest
    pytest api/test_auth.py
"""
import jwt
import pytest
from fastapi.testclient import TestClient

from api import main
from api.main import JWT_SECRET, app

client = TestClient(app)


def _token(secret: str = JWT_SECRET) -> str:
    return jwt.encode(
        {"id": "u1", "email": "demo@petronas.com", "role": "fleet_manager"},
        secret,
        algorithm="HS256",
    )


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


def test_valid_token_passes_auth(monkeypatch):
    # Stub the DB layer so this verifies the auth gate + routing, not DuckDB.
    monkeypatch.setattr(main, "query", lambda sql, params=None: [{"vessels": 3}])
    r = client.get(
        "/api/analytics/summary",
        headers={"Authorization": f"Bearer {_token()}"},
    )
    assert r.status_code == 200
    assert r.json()["vessels"] == 3
