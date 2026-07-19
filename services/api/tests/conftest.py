from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.database import Base, build_engine, get_session
from app.main import create_app


@pytest.fixture
def engine(tmp_path) -> Generator[Engine, None, None]:
    target = build_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(target)
    yield target
    target.dispose()


@pytest.fixture
def session_factory(engine: Engine):
    return sessionmaker(bind=engine, expire_on_commit=False)


@pytest.fixture
def client(session_factory) -> Generator[TestClient, None, None]:
    app = create_app()

    def override_session() -> Generator[Session, None, None]:
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    # Do not enter TestClient's lifespan context: it initializes the configured
    # production database, while these tests deliberately override the DB dependency.
    test_client = TestClient(app)
    yield test_client
    test_client.close()


@pytest.fixture
def enroll(client: TestClient):
    def create() -> str:
        response = client.post(
            "/v1/enroll",
            json={
                "adult_confirmed": True,
                "operational_consent": True,
                "research_consent": True,
                "consent_version": "2026-07-19-intraday-cycle-v2",
            },
        )
        assert response.status_code == 201, response.text
        return response.json()["access_token"]

    return create
