from collections.abc import Generator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.auth import hash_secret
from app.database import Base, build_engine, get_session
from app.main import create_app
from app.models import Invitation


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
def invite(session_factory):
    def create(code: str, *, expired: bool = False) -> None:
        with session_factory() as session:
            delta = timedelta(days=-1 if expired else 1)
            session.add(
                Invitation(
                    code_hash=hash_secret(code),
                    expires_at=datetime.now(UTC) + delta,
                )
            )
            session.commit()

    return create


@pytest.fixture
def enroll(client: TestClient, invite):
    def create(
        code: str = "VALID-CODE",
        *,
        research_opt_in: bool = False,
        seed_demo_history: bool = False,
    ) -> str:
        invite(code)
        response = client.post(
            "/v1/enroll",
            json={
                "invitation_code": code,
                "adult_confirmed": True,
                "operational_consent": True,
                "research_opt_in": research_opt_in,
                "consent_version": "2026-07-01",
                "seed_demo_history": seed_demo_history,
            },
        )
        assert response.status_code == 201, response.text
        return response.json()["access_token"]

    return create
