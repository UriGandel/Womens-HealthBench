from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import func, inspect, select

from app.migrate_cycle_tracking import CYCLE_TABLES, migrate
from app.models import (
    Account,
    CycleDay,
    CycleSyncReceipt,
    CycleTrackingPreference,
    ResearchEvent,
)


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def checkin_payload(
    submission_id: str,
    observed_date: date,
    *,
    fatigue: int = 1,
) -> dict[str, object]:
    return {
        "client_submission_id": submission_id,
        "observed_date": observed_date.isoformat(),
        "period_status": "none",
        "cycle_day": None,
        "sleep_hours": 7.0,
        "sleep_quality": 3,
        "stress": 1,
        "fatigue": fatigue,
        "brain_fog": fatigue,
        "headache": 0,
        "pelvic_pain": fatigue,
        "mood_disruption": 1,
    }


def enable(client: TestClient, token: str) -> None:
    response = client.put(
        "/v1/cycle-tracking",
        json={
            "acknowledged_sensitive_data": True,
            "local_today": date.today().isoformat(),
        },
        headers=auth(token),
    )
    assert response.status_code == 200
    assert response.json()["enabled"] is True


def sync(
    client: TestClient,
    token: str,
    sync_id: str,
    records: list[dict[str, object]],
):
    return client.post(
        "/v1/cycle-days:sync",
        json={
            "sync_id": sync_id,
            "local_today": date.today().isoformat(),
            "records": records,
        },
        headers=auth(token),
    )


def test_cycle_tracking_requires_auth_opt_in_and_valid_window(
    client: TestClient, enroll
) -> None:
    token = enroll()
    today = date.today()
    record = [{"observed_date": today.isoformat(), "period_status": "flow"}]

    assert client.get("/v1/cycle-tracking").status_code == 401
    assert sync(client, token, "cycle-sync-0001", record).status_code == 409
    rejected = client.put(
        "/v1/cycle-tracking",
        json={
            "acknowledged_sensitive_data": False,
            "local_today": today.isoformat(),
        },
        headers=auth(token),
    )
    assert rejected.status_code == 422

    enable(client, token)
    summary = client.get("/v1/account", headers=auth(token))
    assert summary.json()["cycle_tracking_enabled"] is True
    assert summary.json()["cycle_day_count"] == 0
    future = [{"observed_date": (today + timedelta(days=1)).isoformat(), "period_status": "flow"}]
    old = [{"observed_date": (today - timedelta(days=120)).isoformat(), "period_status": "flow"}]
    assert sync(client, token, "cycle-future", future).status_code == 422
    assert sync(client, token, "cycle-too-old", old).status_code == 422

    local_tomorrow = today + timedelta(days=1)
    edge = client.post(
        "/v1/cycle-days:sync",
        json={
            "sync_id": "cycle-local-edge",
            "local_today": local_tomorrow.isoformat(),
            "records": [
                {
                    "observed_date": local_tomorrow.isoformat(),
                    "period_status": "flow",
                }
            ],
        },
        headers=auth(token),
    )
    assert edge.status_code == 200
    invalid_local_date = client.get(
        "/v1/cycle-tracking",
        params={"local_today": (today + timedelta(days=2)).isoformat()},
        headers=auth(token),
    )
    assert invalid_local_date.status_code == 422


def test_cycle_access_physically_prunes_expired_history(
    client: TestClient, enroll, session_factory
) -> None:
    token = enroll()
    enable(client, token)
    today = date.today()
    with session_factory() as session:
        account = session.scalar(select(Account))
        assert account is not None
        session.add_all(
            [
                CycleDay(
                    account_id=account.id,
                    observed_date=today - timedelta(days=120),
                    period_status="flow",
                ),
                CycleDay(
                    account_id=account.id,
                    observed_date=today - timedelta(days=119),
                    period_status="spotting",
                ),
            ]
        )
        session.commit()

    response = client.get(
        "/v1/cycle-tracking",
        params={"local_today": today.isoformat()},
        headers=auth(token),
    )
    assert response.status_code == 200
    assert [day["observed_date"] for day in response.json()["days"]] == [
        (today - timedelta(days=119)).isoformat()
    ]
    with session_factory() as session:
        stored = session.scalars(select(CycleDay).order_by(CycleDay.observed_date)).all()
        assert [day.observed_date for day in stored] == [today - timedelta(days=119)]


def test_checkin_bleeding_history_builds_phase_calendar_without_history_opt_in(
    client: TestClient,
    enroll,
) -> None:
    token = enroll()
    today = date.today()
    starts = [today - timedelta(days=56), today - timedelta(days=28), today]
    for index, observed_date in enumerate(starts):
        payload = checkin_payload(
            f"phase-checkin-{index:02d}",
            observed_date,
        )
        payload["period_status"] = "flow"
        response = client.post(
            "/v1/check-ins",
            json=payload,
            headers=auth(token),
        )
        assert response.status_code == 201, response.text

    response = client.get(
        "/v1/cycle-tracking",
        params={"local_today": today.isoformat()},
        headers=auth(token),
    )
    assert response.status_code == 200
    summary = response.json()
    assert summary["enabled"] is False
    assert [day["period_status"] for day in summary["days"]] == ["flow"] * 3
    assert summary["cycle_start_count"] == 3
    assert summary["prediction_status"] == "ready"
    assert summary["prediction_confidence"] in {"medium", "high"}
    assert len(summary["predicted_period_windows"]) == 2
    assert {
        day["phase"] for day in summary["phase_days"]
    } == {"menstrual", "follicular", "ovulatory", "luteal"}
    assert max(date.fromisoformat(day["observed_date"]) for day in summary["phase_days"]) <= (
        today + timedelta(days=90)
    )


def test_variable_cycle_history_suppresses_phase_projection(
    client: TestClient,
    enroll,
) -> None:
    token = enroll()
    today = date.today()
    starts = [today - timedelta(days=80), today - timedelta(days=60), today]
    for index, observed_date in enumerate(starts):
        payload = checkin_payload(
            f"variable-phase-{index:02d}",
            observed_date,
        )
        payload["period_status"] = "flow"
        assert client.post(
            "/v1/check-ins",
            json=payload,
            headers=auth(token),
        ).status_code == 201

    summary = client.get(
        "/v1/cycle-tracking",
        params={"local_today": today.isoformat()},
        headers=auth(token),
    ).json()
    assert summary["prediction_status"] == "variable"
    assert summary["phase_days"] == []
    assert summary["predicted_period_windows"] == []


def test_history_none_correction_overrides_calendar_but_not_checkin_research(
    client: TestClient,
    enroll,
    session_factory,
) -> None:
    token = enroll()
    today = date.today()
    payload = checkin_payload("cycle-none-override", today)
    payload["period_status"] = "flow"
    assert client.post(
        "/v1/check-ins",
        json=payload,
        headers=auth(token),
    ).status_code == 201
    enable(client, token)

    correction = sync(
        client,
        token,
        "cycle-none-correction",
        [{"observed_date": today.isoformat(), "period_status": None}],
    )
    assert correction.status_code == 200
    assert correction.json()["deleted_days"] == 1
    summary = client.get(
        "/v1/cycle-tracking",
        params={"local_today": today.isoformat()},
        headers=auth(token),
    ).json()
    assert summary["days"] == []

    with session_factory() as session:
        operational = session.scalar(select(CycleDay))
        research = session.scalar(select(ResearchEvent))
        assert operational is not None
        assert operational.period_status == "none"
        assert research is not None
        assert research.period_status == "flow"


def test_cycle_sync_is_idempotent_editable_and_isolated(
    client: TestClient, enroll, session_factory
) -> None:
    first_token = enroll()
    second_token = enroll()
    enable(client, first_token)
    enable(client, second_token)
    today = date.today()
    records = [
        {"observed_date": (today - timedelta(days=2)).isoformat(), "period_status": "spotting"},
        {"observed_date": (today - timedelta(days=1)).isoformat(), "period_status": "flow"},
        {"observed_date": today.isoformat(), "period_status": "flow"},
    ]

    first = sync(client, first_token, "cycle-sync-0002", records)
    assert first.status_code == 200
    assert first.json() == {"accepted_days": 3, "deleted_days": 0, "duplicate": False}
    duplicate = sync(client, first_token, "cycle-sync-0002", records)
    assert duplicate.status_code == 200
    assert duplicate.json()["duplicate"] is True
    enabled_again = client.put(
        "/v1/cycle-tracking",
        json={
            "acknowledged_sensitive_data": True,
            "local_today": today.isoformat(),
        },
        headers=auth(first_token),
    )
    assert len(enabled_again.json()["days"]) == 3
    conflict = sync(
        client,
        first_token,
        "cycle-sync-0002",
        [{"observed_date": today.isoformat(), "period_status": "spotting"}],
    )
    assert conflict.status_code == 409

    other = client.get("/v1/cycle-tracking", headers=auth(second_token))
    assert other.status_code == 200
    assert other.json()["days"] == []

    deleted = sync(
        client,
        first_token,
        "cycle-sync-0003",
        [{"observed_date": today.isoformat(), "period_status": None}],
    )
    assert deleted.status_code == 200
    assert deleted.json()["deleted_days"] == 1
    with session_factory() as session:
        assert session.scalar(select(func.count(CycleDay.id))) == 2


def test_cycle_day_spotting_and_patterns_are_descriptive(
    client: TestClient, enroll
) -> None:
    token = enroll()
    enable(client, token)
    today = date.today()
    starts = [today - timedelta(days=56), today - timedelta(days=28), today]
    records: list[dict[str, object]] = []
    for start in starts:
        records.append({"observed_date": start.isoformat(), "period_status": "flow"})
        if start < today:
            records.append(
                {
                    "observed_date": (start + timedelta(days=1)).isoformat(),
                    "period_status": "flow",
                }
            )
    records.append(
        {
            "observed_date": (today - timedelta(days=1)).isoformat(),
            "period_status": "spotting",
        }
    )
    assert sync(client, token, "cycle-patterns", records).status_code == 200

    bleeding_dates = [starts[0], starts[1], starts[2]]
    other_dates = [
        starts[0] + timedelta(days=10),
        starts[1] + timedelta(days=10),
        today - timedelta(days=10),
    ]
    for index, observed_date in enumerate(bleeding_dates):
        response = client.post(
            "/v1/check-ins",
            json=checkin_payload(f"bleeding-{index:02d}", observed_date, fatigue=4),
            headers=auth(token),
        )
        assert response.status_code == 201
    for index, observed_date in enumerate(other_dates):
        response = client.post(
            "/v1/check-ins",
            json=checkin_payload(f"other-{index:02d}", observed_date, fatigue=0),
            headers=auth(token),
        )
        assert response.status_code == 201

    summary = client.get("/v1/cycle-tracking", headers=auth(token)).json()
    assert summary["current_cycle_day"] == 1
    assert summary["cycle_started_on"] == today.isoformat()
    assert summary["cycle_start_count"] == 3
    assert summary["observed_cycle_length_days"] == 28.0
    assert summary["pattern_status"] == "ready"
    assert [pattern["label"] for pattern in summary["patterns"]] == [
        "Brain fog",
        "Fatigue",
        "Pelvic pain",
    ]
    assert all("your records" in pattern["detail"] for pattern in summary["patterns"])


def test_cycle_history_affects_matching_forecast_but_not_research(
    client: TestClient, enroll, session_factory
) -> None:
    token = enroll()
    enable(client, token)
    today = date.today()
    for offset in range(7):
        observed_date = today - timedelta(days=6 - offset)
        response = client.post(
            "/v1/check-ins",
            json=checkin_payload(f"forecast-cycle-{offset}", observed_date),
            headers=auth(token),
        )
        assert response.status_code == 201

    assert sync(
        client,
        token,
        "cycle-forecast-match",
        [{"observed_date": today.isoformat(), "period_status": "flow"}],
    ).status_code == 200
    forecast = client.get("/v1/forecast", headers=auth(token)).json()
    assert forecast["model_version"] == "tomorrow-gently-transparent-0.2.0"
    assert any(factor["label"] == "Cycle context" for factor in forecast["factors"])
    cycle_factor = next(
        factor for factor in forecast["factors"] if factor["label"] == "Cycle context"
    )
    assert "Separately logged cycle history" in cycle_factor["detail"]

    with session_factory() as session:
        assert session.scalar(select(func.count(ResearchEvent.id))) == 7


def test_forecast_cycle_fallback_unrelated_date_and_insufficient_data(
    client: TestClient, enroll
) -> None:
    today = date.today()

    fallback_token = enroll()
    enable(client, fallback_token)
    for offset in range(7):
        payload = checkin_payload(
            f"fallback-cycle-{offset}",
            today - timedelta(days=6 - offset),
        )
        if offset == 6:
            payload["period_status"] = "spotting"
        assert (
            client.post("/v1/check-ins", json=payload, headers=auth(fallback_token)).status_code
            == 201
        )
    fallback = client.get("/v1/forecast", headers=auth(fallback_token)).json()
    fallback_factor = next(
        factor for factor in fallback["factors"] if factor["label"] == "Cycle context"
    )
    assert fallback_factor["detail"] == "Your latest check-in reported spotting or flow."

    unrelated_token = enroll()
    enable(client, unrelated_token)
    for offset in range(7):
        payload = checkin_payload(
            f"unrelated-cycle-{offset}",
            today - timedelta(days=6 - offset),
        )
        assert (
            client.post(
                "/v1/check-ins",
                json=payload,
                headers=auth(unrelated_token),
            ).status_code
            == 201
        )
    assert sync(
        client,
        unrelated_token,
        "cycle-unrelated-date",
        [
            {
                "observed_date": (today - timedelta(days=1)).isoformat(),
                "period_status": "flow",
            }
        ],
    ).status_code == 200
    unrelated = client.get("/v1/forecast", headers=auth(unrelated_token)).json()
    assert all(factor["label"] != "Cycle context" for factor in unrelated["factors"])

    cold_token = enroll()
    enable(client, cold_token)
    assert (
        client.post(
            "/v1/check-ins",
            json=checkin_payload("cold-cycle-context", today),
            headers=auth(cold_token),
        ).status_code
        == 201
    )
    assert sync(
        client,
        cold_token,
        "cycle-cold-match",
        [{"observed_date": today.isoformat(), "period_status": "flow"}],
    ).status_code == 200
    cold = client.get("/v1/forecast", headers=auth(cold_token)).json()
    assert cold["status"] == "insufficient_data"
    assert cold["factors"] == []


def test_disable_and_account_delete_remove_cycle_operational_data(
    client: TestClient, enroll, session_factory
) -> None:
    token = enroll()
    enable(client, token)
    assert sync(
        client,
        token,
        "cycle-delete-0001",
        [{"observed_date": date.today().isoformat(), "period_status": "flow"}],
    ).status_code == 200

    deleted = client.delete("/v1/cycle-tracking", headers=auth(token))
    assert deleted.status_code == 200
    assert deleted.json()["deleted_days"] == 1
    with session_factory() as session:
        assert session.scalar(select(func.count(CycleDay.id))) == 0
        assert session.scalar(select(func.count(CycleSyncReceipt.id))) == 0
        assert session.scalar(select(func.count(CycleTrackingPreference.account_id))) == 0

    enable(client, token)
    assert sync(
        client,
        token,
        "cycle-account-cascade",
        [{"observed_date": date.today().isoformat(), "period_status": "spotting"}],
    ).status_code == 200
    assert client.delete("/v1/account", headers=auth(token)).status_code == 200
    with session_factory() as session:
        assert session.scalar(select(func.count(CycleTrackingPreference.account_id))) == 0
        assert session.scalar(select(func.count(CycleDay.id))) == 0
        assert session.scalar(select(func.count(CycleSyncReceipt.id))) == 0


def test_cycle_migration_is_additive_and_repeatable(tmp_path) -> None:
    from app.database import Base, build_engine

    target = build_engine(f"sqlite:///{tmp_path / 'cycle-migration.db'}")
    cycle_table_names = {table.name for table in CYCLE_TABLES}
    for table in Base.metadata.sorted_tables:
        if table.name not in cycle_table_names:
            table.create(target, checkfirst=True)
    created = migrate(target)
    assert created == tuple(table.name for table in CYCLE_TABLES)
    assert migrate(target) == ()
    inspector = inspect(target)
    assert all(inspector.has_table(table.name) for table in CYCLE_TABLES)
    target.dispose()
