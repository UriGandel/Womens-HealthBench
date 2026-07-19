from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.export_research import EXPORT_FIELDS, export_record, export_records
from app.models import (
    Account,
    CheckIn,
    ConsentRecord,
    ParticipantLink,
    ResearchEvent,
    ResearchWearableDay,
    WearableConnection,
    WearableDailySummary,
    WearableSyncReceipt,
)


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


def wearable_record(observed_date: date, **overrides: object) -> dict[str, object]:
    return {
        "observed_date": observed_date.isoformat(),
        "platform": "apple_health",
        "sleep_minutes": 438,
        "steps": 8123,
        "activity_minutes": 47,
        "active_energy_kcal": 512.4,
        "resting_heart_rate_bpm": 61.0,
        "hrv_ms": 42.3,
        "hrv_method": "sdnn",
        "respiratory_rate_bpm": 15.2,
        "oxygen_saturation_pct": 97.5,
        "peripheral_temperature_delta_c": 0.18,
        **overrides,
    }


def enrollment_body() -> dict[str, object]:
    return {
        "adult_confirmed": True,
        "operational_consent": True,
        "research_consent": True,
        "consent_version": "2026-07-19-intraday-cycle-v2",
    }


def test_enrollment_requires_current_mandatory_consent_without_invitation(
    client: TestClient,
) -> None:
    for field in ("adult_confirmed", "operational_consent", "research_consent"):
        body = {**enrollment_body(), field: False}
        assert client.post("/v1/enroll", json=body).status_code == 422

    outdated = {**enrollment_body(), "consent_version": "2026-07-01"}
    assert client.post("/v1/enroll", json=outdated).status_code == 409

    obsolete = {**enrollment_body(), "seed_demo_history": True}
    assert client.post("/v1/enroll", json=obsolete).status_code == 422

    legacy = {**enrollment_body(), "invitation_code": "NO-LONGER-ACCEPTED"}
    assert client.post("/v1/enroll", json=legacy).status_code == 422

    body = enrollment_body()
    response = client.post("/v1/enroll", json=body)
    assert response.status_code == 201
    assert set(response.json()) == {"access_token", "consent_version"}
    second = client.post("/v1/enroll", json=body)
    assert second.status_code == 201
    assert second.json()["access_token"] != response.json()["access_token"]


def test_auth_is_required_and_sensitive_responses_are_not_cacheable(
    client: TestClient, enroll
) -> None:
    assert client.get("/v1/account").status_code == 401
    assert client.get("/v1/account", headers=auth("wrong")).status_code == 401

    token = enroll()
    response = client.get("/v1/account", headers=auth(token))
    assert response.status_code == 200
    assert response.json()["consent_current"] is True
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["pragma"] == "no-cache"


def test_checkin_is_idempotent_and_always_contributes_to_research(
    client: TestClient, enroll, session_factory
) -> None:
    token = enroll()
    payload = checkin_payload("submission-0001", date.today())
    first = client.post("/v1/check-ins", json=payload, headers=auth(token))
    assert first.status_code == 201
    assert first.json()["duplicate"] is False
    assert first.json()["research_contributed"] is True

    duplicate = client.post("/v1/check-ins", json=payload, headers=auth(token))
    assert duplicate.status_code == 200
    assert duplicate.json()["id"] == first.json()["id"]
    assert duplicate.json()["duplicate"] is True
    assert duplicate.json()["research_contributed"] is True

    with session_factory() as session:
        assert session.scalar(select(func.count(ResearchEvent.id))) == 1

    changed = {**payload, "fatigue": 4}
    conflict = client.post("/v1/check-ins", json=changed, headers=auth(token))
    assert conflict.status_code == 409

    future = checkin_payload("submission-0002", date.today() + timedelta(days=1))
    assert client.post("/v1/check-ins", json=future, headers=auth(token)).status_code == 422


def test_same_client_submission_id_is_safe_across_accounts(
    client: TestClient, enroll
) -> None:
    first_token = enroll()
    second_token = enroll()
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

    payload = checkin_payload("forecast-0006", date.today(), fatigue=4)
    assert client.post("/v1/check-ins", json=payload, headers=auth(token)).status_code == 201
    ready = client.get("/v1/forecast", headers=auth(token))
    assert ready.status_code == 200
    result = ready.json()
    assert result["status"] == "ready"
    assert 0 <= result["probability"] <= 1
    assert result["confidence"] == "low"
    assert result["factors"]
    assert "not a diagnosis" in result["disclaimer"]


def test_research_rows_are_pseudonymous_and_rebase_out_of_order(
    client: TestClient, enroll, session_factory
) -> None:
    token = enroll()
    for submission_id, offset in (("today-row", 0), ("oldest-row", 2), ("middle-row", 1)):
        response = client.post(
            "/v1/check-ins",
            json=checkin_payload(submission_id, date.today() - timedelta(days=offset)),
            headers=auth(token),
        )
        assert response.status_code == 201

    with session_factory() as session:
        events = session.scalars(
            select(ResearchEvent).order_by(ResearchEvent.day_in_study)
        ).all()
        assert [event.day_in_study for event in events] == [0, 1, 2]
        assert len({event.source_checkin_id for event in events}) == 3

        event = events[0]
        checkin = session.get(CheckIn, event.source_checkin_id)
        assert checkin is not None
        assert checkin.client_submission_id not in vars(event).values()
        exported = export_record(event)
        assert tuple(exported) == EXPORT_FIELDS
        assert exported["participant_id"] == event.research_id
        assert exported["day_in_study"] == 0
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


def test_outdated_consent_blocks_data_until_terms_are_reaccepted(
    client: TestClient, enroll, session_factory
) -> None:
    token = enroll()
    with session_factory() as session:
        account = session.scalar(select(Account))
        assert account is not None
        session.add(
            ConsentRecord(
                account_id=account.id,
                consent_version="2026-07-01",
                operational_accepted=True,
                research_opt_in=True,
                action="legacy_terms",
            )
        )
        session.commit()

    assert client.get("/v1/forecast", headers=auth(token)).status_code == 428
    summary = client.get("/v1/account", headers=auth(token))
    assert summary.status_code == 200
    assert summary.json()["consent_current"] is False

    rejected = client.put(
        "/v1/consent",
        json={
            "operational_consent": True,
            "research_consent": False,
            "consent_version": "2026-07-19-intraday-cycle-v2",
        },
        headers=auth(token),
    )
    assert rejected.status_code == 422

    accepted = client.put(
        "/v1/consent",
        json={
            "operational_consent": True,
            "research_consent": True,
            "consent_version": "2026-07-19-intraday-cycle-v2",
        },
        headers=auth(token),
    )
    assert accepted.status_code == 200
    assert accepted.json()["consent_current"] is True
    assert client.get("/v1/forecast", headers=auth(token)).status_code == 200


def test_wearable_sync_is_idempotent_replaces_nulls_and_rebases_research(
    client: TestClient, enroll, session_factory
) -> None:
    token = enroll()
    today = date.today()
    checkin = checkin_payload("wearable-overlap", today)
    assert client.post("/v1/check-ins", json=checkin, headers=auth(token)).status_code == 201

    payload = {
        "sync_id": "wearable-sync-0001",
        "records": [
            wearable_record(today - timedelta(days=2)),
            wearable_record(today, steps=0, oxygen_saturation_pct=None),
        ],
    }
    first = client.post("/v1/wearable-days:sync", json=payload, headers=auth(token))
    assert first.status_code == 200
    assert first.json()["accepted_days"] == 2
    assert first.json()["duplicate"] is False

    duplicate = client.post("/v1/wearable-days:sync", json=payload, headers=auth(token))
    assert duplicate.status_code == 200
    assert duplicate.json()["duplicate"] is True

    conflict = {
        **payload,
        "records": [wearable_record(today, steps=999)],
    }
    assert (
        client.post("/v1/wearable-days:sync", json=conflict, headers=auth(token)).status_code
        == 409
    )

    with session_factory() as session:
        summaries = session.scalars(
            select(WearableDailySummary).order_by(WearableDailySummary.observed_date)
        ).all()
        assert len(summaries) == 2
        assert summaries[-1].steps == 0
        assert summaries[-1].oxygen_saturation_pct is None
        research_wearables = session.scalars(
            select(ResearchWearableDay).order_by(ResearchWearableDay.day_in_study)
        ).all()
        research_checkin = session.scalar(select(ResearchEvent))
        assert [row.day_in_study for row in research_wearables] == [0, 2]
        assert research_checkin is not None
        assert research_checkin.day_in_study == 2
        exported = export_records([research_checkin], list(research_wearables))
        assert len(exported) == 2
        assert exported[0]["has_self_report"] is False
        assert exported[1]["has_self_report"] is True
        assert exported[1]["has_wearable"] is True
        assert exported[1]["steps"] == 0
        forbidden = {
            "observed_date",
            "platform",
            "source_wearable_day_id",
            "device_id",
            "source_app",
        }
        assert all(forbidden.isdisjoint(row) for row in exported)

    replacement = {
        "sync_id": "wearable-sync-0002",
        "records": [
            wearable_record(
                today,
                sleep_minutes=None,
                steps=None,
                activity_minutes=None,
                active_energy_kcal=None,
                resting_heart_rate_bpm=None,
                hrv_ms=None,
                hrv_method=None,
                respiratory_rate_bpm=None,
                oxygen_saturation_pct=None,
                peripheral_temperature_delta_c=None,
            )
        ],
    }
    deleted = client.post(
        "/v1/wearable-days:sync",
        json=replacement,
        headers=auth(token),
    )
    assert deleted.status_code == 200
    assert deleted.json()["deleted_days"] == 1


def test_wearable_validation_account_isolation_and_disconnect(
    client: TestClient, enroll, session_factory
) -> None:
    first_token = enroll()
    second_token = enroll()
    today = date.today()
    payload = {
        "sync_id": "wearable-isolation",
        "records": [wearable_record(today)],
    }
    assert (
        client.post("/v1/wearable-days:sync", json=payload, headers=auth(first_token)).status_code
        == 200
    )
    assert (
        client.post("/v1/wearable-days:sync", json=payload, headers=auth(second_token)).status_code
        == 200
    )

    invalid_hrv = {
        "sync_id": "wearable-bad-hrv",
        "records": [wearable_record(today, hrv_method=None)],
    }
    assert (
        client.post(
            "/v1/wearable-days:sync",
            json=invalid_hrv,
            headers=auth(first_token),
        ).status_code
        == 422
    )
    too_old = {
        "sync_id": "wearable-too-old",
        "records": [wearable_record(today - timedelta(days=32))],
    }
    assert (
        client.post(
            "/v1/wearable-days:sync",
            json=too_old,
            headers=auth(first_token),
        ).status_code
        == 422
    )

    summary = client.get("/v1/account", headers=auth(first_token)).json()
    assert summary["wearable_connected"] is True
    assert summary["wearable_platform"] == "apple_health"
    assert summary["wearable_day_count"] == 1

    disconnected = client.delete("/v1/wearable-data", headers=auth(first_token))
    assert disconnected.status_code == 200
    assert disconnected.json()["deleted_days"] == 1
    assert client.get("/v1/account", headers=auth(first_token)).json()[
        "wearable_connected"
    ] is False
    assert client.get("/v1/account", headers=auth(second_token)).json()[
        "wearable_day_count"
    ] == 1

    with session_factory() as session:
        assert session.scalar(select(func.count(WearableDailySummary.id))) == 1
        assert session.scalar(select(func.count(ResearchWearableDay.id))) == 1


def test_research_opt_out_endpoint_is_removed(client: TestClient, enroll) -> None:
    token = enroll()
    response = client.put(
        "/v1/research-consent",
        json={"research_opt_in": False},
        headers=auth(token),
    )
    assert response.status_code == 404


def test_account_deletion_cascades_all_identity_health_and_research_rows(
    client: TestClient, enroll, session_factory
) -> None:
    token = enroll()
    payload = checkin_payload("delete-checkin", date.today())
    assert client.post("/v1/check-ins", json=payload, headers=auth(token)).status_code == 201
    wearable_payload = {
        "sync_id": "delete-wearable",
        "records": [wearable_record(date.today())],
    }
    assert (
        client.post(
            "/v1/wearable-days:sync",
            json=wearable_payload,
            headers=auth(token),
        ).status_code
        == 200
    )

    deleted = client.delete("/v1/account", headers=auth(token))
    assert deleted.status_code == 200
    assert client.get("/v1/account", headers=auth(token)).status_code == 401

    with session_factory() as session:
        for model in (
            Account,
            ParticipantLink,
            ConsentRecord,
            CheckIn,
            ResearchEvent,
            WearableConnection,
            WearableDailySummary,
            WearableSyncReceipt,
            ResearchWearableDay,
        ):
            assert session.scalar(select(func.count()).select_from(model)) == 0


def test_checkin_history_returns_newest_days_and_requires_auth(
    client: TestClient, enroll
) -> None:
    token = enroll()
    assert client.get("/v1/check-ins").status_code == 401

    empty = client.get("/v1/check-ins", headers=auth(token))
    assert empty.status_code == 200
    assert empty.json() == {"days": []}

    today = date.today()
    for offset in range(16):
        payload = checkin_payload(
            f"history-{offset:02d}", today - timedelta(days=offset), fatigue=offset % 5
        )
        assert client.post("/v1/check-ins", json=payload, headers=auth(token)).status_code == 201

    response = client.get("/v1/check-ins", headers=auth(token))
    assert response.status_code == 200
    days = response.json()["days"]
    # Capped at the newest 14 of the 16 submitted, newest first.
    assert len(days) == 14
    assert days[0]["observed_date"] == today.isoformat()
    assert days[-1]["observed_date"] == (today - timedelta(days=13)).isoformat()
    assert {"id", "created_at"}.isdisjoint(days[0])

    # History is scoped to the requesting account.
    other = enroll()
    isolated = client.get("/v1/check-ins", headers=auth(other))
    assert isolated.json() == {"days": []}
