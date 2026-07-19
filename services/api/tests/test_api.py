from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.export_research import EXPORT_FIELDS, export_record
from app.models import Account, CheckIn, ConsentRecord, ParticipantLink, ResearchEvent


def checkin_payload(
    submission_id: str,
    observed_date: date,
    *,
    fatigue: int = 2,
) -> dict[str, object]:
    return {
        "client_submission_id": submission_id,
        "observed_date": observed_date.isoformat(),
        "period_status": "none",
        "cycle_day": None,
        "sleep_hours": 7.0,
        "sleep_quality": 3,
        "stress": 2,
        "fatigue": fatigue,
        "brain_fog": 1,
        "headache": 0,
        "pelvic_pain": 1,
        "mood_disruption": 1,
    }


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_enrollment_rejects_expired_used_and_invalid_consent(
    client: TestClient, invite
) -> None:
    invite("EXPIRED", expired=True)
    body = {
        "invitation_code": "EXPIRED",
        "adult_confirmed": True,
        "operational_consent": True,
        "research_opt_in": False,
        "consent_version": "2026-07-01",
    }
    assert client.post("/v1/enroll", json=body).status_code == 403

    invite("CURRENT")
    body["invitation_code"] = "CURRENT"
    body["consent_version"] = "old"
    assert client.post("/v1/enroll", json=body).status_code == 409
    body["consent_version"] = "2026-07-01"
    assert client.post("/v1/enroll", json=body).status_code == 201
    assert client.post("/v1/enroll", json=body).status_code == 403

    invite("MINOR")
    body["invitation_code"] = "MINOR"
    body["adult_confirmed"] = False
    assert client.post("/v1/enroll", json=body).status_code == 422


def test_auth_is_required_and_sensitive_responses_are_not_cacheable(
    client: TestClient, enroll
) -> None:
    assert client.get("/v1/account").status_code == 401
    assert client.get("/v1/account", headers=auth("wrong")).status_code == 401

    token = enroll()
    response = client.get("/v1/account", headers=auth(token))
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["pragma"] == "no-cache"


def test_checkin_is_idempotent_only_for_identical_payload(
    client: TestClient, enroll
) -> None:
    token = enroll()
    payload = checkin_payload("submission-0001", date.today())
    first = client.post("/v1/check-ins", json=payload, headers=auth(token))
    assert first.status_code == 201
    assert first.json()["duplicate"] is False

    duplicate = client.post("/v1/check-ins", json=payload, headers=auth(token))
    assert duplicate.status_code == 200
    assert duplicate.json()["id"] == first.json()["id"]
    assert duplicate.json()["duplicate"] is True

    changed = {**payload, "fatigue": 4}
    conflict = client.post("/v1/check-ins", json=changed, headers=auth(token))
    assert conflict.status_code == 409
    assert "different check-in" in conflict.json()["detail"]

    future = checkin_payload("submission-0002", date.today() + timedelta(days=1))
    assert client.post("/v1/check-ins", json=future, headers=auth(token)).status_code == 422


def test_same_client_submission_id_is_safe_across_accounts(
    client: TestClient, enroll
) -> None:
    first_token = enroll("FIRST-CODE", research_opt_in=True)
    second_token = enroll("SECOND-CODE", research_opt_in=True)
    payload = checkin_payload("shared-client-id", date.today())
    assert client.post("/v1/check-ins", json=payload, headers=auth(first_token)).status_code == 201
    assert client.post("/v1/check-ins", json=payload, headers=auth(second_token)).status_code == 201


def test_forecast_requires_seven_checkins_and_then_is_transparent(
    client: TestClient, enroll
) -> None:
    token = enroll()
    for offset in range(6):
        payload = checkin_payload(
            f"forecast-{offset:04d}",
            date.today() - timedelta(days=6 - offset),
        )
        assert client.post("/v1/check-ins", json=payload, headers=auth(token)).status_code == 201

    cold = client.get("/v1/forecast", headers=auth(token))
    assert cold.status_code == 200
    assert cold.json()["status"] == "insufficient_data"
    assert cold.json()["usable_checkins"] == 6
    assert cold.json()["probability"] is None

    payload = checkin_payload("forecast-0006", date.today(), fatigue=4)
    assert client.post("/v1/check-ins", json=payload, headers=auth(token)).status_code == 201
    ready = client.get("/v1/forecast", headers=auth(token))
    assert ready.status_code == 200
    result = ready.json()
    assert result["status"] == "ready"
    assert 0 <= result["probability"] <= 1
    assert result["confidence"] == "low"
    assert result["model_version"]
    assert result["factors"]
    assert "not a diagnosis" in result["disclaimer"]


def test_research_opt_in_backfills_real_rows_and_withdrawal_removes_them(
    client: TestClient, enroll, session_factory
) -> None:
    token = enroll(seed_demo_history=True)
    real = checkin_payload("real-checkin-01", date.today())
    response = client.post("/v1/check-ins", json=real, headers=auth(token))
    assert response.status_code == 201
    assert response.json()["research_contributed"] is False

    opted_in = client.put(
        "/v1/research-consent",
        json={
            "research_opt_in": True,
            "consent_version": "2026-07-01",
            "contribute_existing": True,
        },
        headers=auth(token),
    )
    assert opted_in.status_code == 200
    assert opted_in.json()["contributed_records"] == 1

    with session_factory() as session:
        event = session.scalar(select(ResearchEvent))
        checkin = session.scalar(select(CheckIn).where(CheckIn.is_synthetic.is_(False)))
        assert event is not None
        assert checkin is not None
        assert event.source_checkin_id == checkin.id
        assert event.day_in_study == 0
        assert checkin.client_submission_id not in vars(event).values()
        exported = export_record(event)
        assert tuple(exported) == EXPORT_FIELDS
        assert exported["schema_version"] == "1.0.0"
        assert exported["participant_id"] == event.research_id
        assert exported["day_in_study"] == 0
        assert exported["source"] == "private-alpha"
        assert exported["activity_minutes"] is None
        forbidden = {
            "account_id",
            "observed_date",
            "client_submission_id",
            "source_checkin_id",
            "created_at",
            "device_id",
            "ip_address",
            "free_text",
        }
        assert forbidden.isdisjoint(exported)

    withdrawn = client.put(
        "/v1/research-consent",
        json={
            "research_opt_in": False,
            "consent_version": "2026-07-01",
            "contribute_existing": False,
        },
        headers=auth(token),
    )
    assert withdrawn.status_code == 200
    assert withdrawn.json()["contributed_records"] == 0
    summary = client.get("/v1/account", headers=auth(token)).json()
    assert summary["research_opt_in"] is False
    assert summary["research_record_count"] == 0

    with session_factory() as session:
        actions = session.scalars(
            select(ConsentRecord.action).order_by(ConsentRecord.id)
        ).all()
        assert actions == ["enrolled", "research_opt_in", "research_withdrawal"]


def test_opted_out_checkins_never_create_research_rows(
    client: TestClient, enroll, session_factory
) -> None:
    token = enroll()
    payload = checkin_payload("private-checkin", date.today())
    assert client.post("/v1/check-ins", json=payload, headers=auth(token)).status_code == 201
    opted_in_without_backfill = client.put(
        "/v1/research-consent",
        json={
            "research_opt_in": True,
            "consent_version": "2026-07-01",
            "contribute_existing": False,
        },
        headers=auth(token),
    )
    assert opted_in_without_backfill.status_code == 200
    duplicate = client.post("/v1/check-ins", json=payload, headers=auth(token))
    assert duplicate.status_code == 200
    assert duplicate.json()["research_contributed"] is False
    with session_factory() as session:
        assert session.scalar(select(func.count(ResearchEvent.id))) == 0


def test_research_timeline_rebases_out_of_order_without_preconsent_backfill(
    client: TestClient, enroll, session_factory
) -> None:
    token = enroll()
    preconsent = checkin_payload("preconsent", date.today() - timedelta(days=2))
    assert client.post("/v1/check-ins", json=preconsent, headers=auth(token)).status_code == 201
    opted_in = client.put(
        "/v1/research-consent",
        json={
            "research_opt_in": True,
            "consent_version": "2026-07-01",
            "contribute_existing": False,
        },
        headers=auth(token),
    )
    assert opted_in.status_code == 200

    today = checkin_payload("postconsent-today", date.today())
    yesterday = checkin_payload("postconsent-yesterday", date.today() - timedelta(days=1))
    assert client.post("/v1/check-ins", json=today, headers=auth(token)).status_code == 201
    assert client.post("/v1/check-ins", json=yesterday, headers=auth(token)).status_code == 201

    with session_factory() as session:
        events = session.scalars(
            select(ResearchEvent).order_by(ResearchEvent.day_in_study)
        ).all()
        assert [event.day_in_study for event in events] == [0, 1]
        contributed_ids = {event.source_checkin_id for event in events}
        preconsent_row = session.scalar(
            select(CheckIn).where(CheckIn.client_submission_id == "preconsent")
        )
        assert preconsent_row is not None
        assert preconsent_row.id not in contributed_ids


def test_account_deletion_cascades_all_identity_health_and_research_rows(
    client: TestClient, enroll, session_factory
) -> None:
    token = enroll(research_opt_in=True)
    payload = checkin_payload("delete-checkin", date.today())
    assert client.post("/v1/check-ins", json=payload, headers=auth(token)).status_code == 201

    deleted = client.delete("/v1/account", headers=auth(token))
    assert deleted.status_code == 200
    assert client.get("/v1/account", headers=auth(token)).status_code == 401

    with session_factory() as session:
        for model in (Account, ParticipantLink, ConsentRecord, CheckIn, ResearchEvent):
            assert session.scalar(select(func.count()).select_from(model)) == 0
