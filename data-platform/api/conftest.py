"""Shared pytest fixtures for the analytics API tests."""
import pytest

from api import main


@pytest.fixture(autouse=True)
def _fresh_rate_limit():
    # The per-user limiter is process-global, and the suites make many requests
    # as the same test user. Without a reset, whichever test happened to run
    # after the 60th request would get a 429 for reasons unrelated to it.
    main._limiter.reset()
    yield
    main._limiter.reset()
