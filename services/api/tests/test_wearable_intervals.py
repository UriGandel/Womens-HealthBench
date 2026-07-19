from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.export_research import export_interval_record
from app.models import (
    ResearchWearableInterval,
    WearableIntervalSummary,
    WearableIntervalSyncReceipt,
)


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def interval_record(
    observed_date: date,
    bucket_start_hour: int,
    **overrides: object,
) -> dict[str, object]:
    record: dict[str, object] = {
        "observed_date": observed_date.isoformat(),
        "bucket_start_hour": bucket_start_hour,
        "platform": "apple_health",
        "steps": 1200,
        "activity_minutes": 18,
        "active_energy_kcal": 145.5,
        "heart_rate_avg_bpm": 72.0,
        "heart_rate_min_bpm": 51.0,
        "heart_rate_max_bpm": 131.0,
        "heart_rate_sample_count": 48,
        "hrv_avg_ms": 41.0,
        "hrv_sample_count": 3,
        "hrv_method": "sdnn",
        "respiratory_rate_avg_bpm": 15.2,
        "respiratory_rate_sample_count": 4,
        "oxygen_saturation_avg_pct": 97.4,
        "oxygen_saturation_sample_count": 5,
    }
    record.update(overrides)
    return record


def test_interval_sync_supports_four_buckets_idempotency_and_research_export(
    client: TestClient,
    enroll,
    session_factory,
) -> None:
    token = enroll()
    today = date.today()
    records = [interval_record(today, hour) for hour in (0, 6, 12, 18)]
    payload = {"sync_id": "interval-sync-0001", "records": records}

    first = client.post(
        "/v1/wearable-intervals:sync",
        json=payload,
        headers=auth(token),
    )
    assert first.status_code == 200, first.text
    assert first.json()["accepted_intervals"] == 4
    assert first.json()["deleted_intervals"] == 0
    assert first.json()["duplicate"] is False

    duplicate = client.post(
        "/v1/wearable-intervals:sync",
        json=payload,
        headers=auth(token),
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["duplicate"] is True

    conflict = {
        **payload,
        "records": [interval_record(today, 0, steps=999)],
    }
    assert client.post(
        "/v1/wearable-intervals:sync",
        json=conflict,
        headers=auth(token),
    ).status_code == 409

    with session_factory() as session:
        stored = session.scalars(
            select(WearableIntervalSummary).order_by(
                WearableIntervalSummary.bucket_start_hour
            )
        ).all()
        research = session.scalars(
            select(ResearchWearableInterval).order_by(
                ResearchWearableInterval.bucket_index
            )
        ).all()
        assert [row.bucket_start_hour for row in stored] == [0, 6, 12, 18]
        assert [row.bucket_index for row in research] == [0, 1, 2, 3]
        exported = export_interval_record(research[0])
        assert exported["schema_version"] == "1.0.0"
        assert exported["bucket_index"] == 0
        assert {
            "observed_date",
            "platform",
            "source_wearable_interval_id",
            "bucket_start_hour",
        }.isdisjoint(exported)


def test_interval_replacement_deletion_validation_isolation_and_disconnect(
    client: TestClient,
    enroll,
    session_factory,
) -> None:
    first_token = enroll()
    second_token = enroll()
    today = date.today()
    initial = {
        "sync_id": "interval-isolation",
        "records": [interval_record(today, 6)],
    }
    for token in (first_token, second_token):
        response = client.post(
            "/v1/wearable-intervals:sync",
            json=initial,
            headers=auth(token),
        )
        assert response.status_code == 200, response.text

    invalid_pair = {
        "sync_id": "interval-bad-pair",
        "records": [
            interval_record(
                today,
                12,
                hrv_avg_ms=None,
                hrv_sample_count=2,
                hrv_method=None,
            )
        ],
    }
    assert client.post(
        "/v1/wearable-intervals:sync",
        json=invalid_pair,
        headers=auth(first_token),
    ).status_code == 422
    too_old = {
        "sync_id": "interval-too-old",
        "records": [interval_record(today - timedelta(days=32), 0)],
    }
    assert client.post(
        "/v1/wearable-intervals:sync",
        json=too_old,
        headers=auth(first_token),
    ).status_code == 422

    empty = interval_record(
        today,
        6,
        steps=None,
        activity_minutes=None,
        active_energy_kcal=None,
        heart_rate_avg_bpm=None,
        heart_rate_min_bpm=None,
        heart_rate_max_bpm=None,
        heart_rate_sample_count=None,
        hrv_avg_ms=None,
        hrv_sample_count=None,
        hrv_method=None,
        respiratory_rate_avg_bpm=None,
        respiratory_rate_sample_count=None,
        oxygen_saturation_avg_pct=None,
        oxygen_saturation_sample_count=None,
    )
    deleted = client.post(
        "/v1/wearable-intervals:sync",
        json={"sync_id": "interval-delete-0001", "records": [empty]},
        headers=auth(first_token),
    )
    assert deleted.status_code == 200
    assert deleted.json()["deleted_intervals"] == 1

    disconnected = client.delete("/v1/wearable-data", headers=auth(second_token))
    assert disconnected.status_code == 200
    with session_factory() as session:
        assert session.scalar(select(func.count(WearableIntervalSummary.id))) == 0
        assert session.scalar(select(func.count(ResearchWearableInterval.id))) == 0
        assert session.scalar(select(func.count(WearableIntervalSyncReceipt.id))) == 2

    assert client.delete("/v1/wearable-data", headers=auth(first_token)).status_code == 200
    with session_factory() as session:
        assert session.scalar(select(func.count(WearableIntervalSyncReceipt.id))) == 0


def test_account_deletion_cascades_interval_operational_and_research_rows(
    client: TestClient,
    enroll,
    session_factory,
) -> None:
    token = enroll()
    response = client.post(
        "/v1/wearable-intervals:sync",
        json={
            "sync_id": "interval-account-delete",
            "records": [interval_record(date.today(), 0)],
        },
        headers=auth(token),
    )
    assert response.status_code == 200, response.text
    assert client.delete("/v1/account", headers=auth(token)).status_code == 200
    with session_factory() as session:
        for model in (
            WearableIntervalSummary,
            WearableIntervalSyncReceipt,
            ResearchWearableInterval,
        ):
            assert session.scalar(select(func.count()).select_from(model)) == 0
