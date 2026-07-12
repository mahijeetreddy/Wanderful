from __future__ import annotations

import os
from pathlib import Path


TEST_DB = Path(".crewai_runtime") / "test-wanderful.db"
TEST_DB.parent.mkdir(parents=True, exist_ok=True)
os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.resolve().as_posix()}"
os.environ["AUTH_SECRET_KEY"] = "test-secret"
os.environ["ADMIN_EMAILS"] = "admin@example.com"
os.environ["CSRF_ENFORCED"] = "false"
os.environ["PLANNING_ENABLED"] = "true"

import pytest

from database import Base, engine
from web_app import app


@pytest.fixture(autouse=True)
def reset_database():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture()
def client():
    app.config.update(TESTING=True)
    return app.test_client()
