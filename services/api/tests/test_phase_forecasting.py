from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import pandas as pd
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth import hash_secret
from app.models import Account, WearableDailySummary
from app.phase_forecasting import (
    PHASE_CLASSES,
    V01_FEATURE_NAMES,
    V02_FEATURE_NAMES,
    build_v02_features,
)


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class RecordingModel:
    classes_ = PHASE_CLASSES

    def __init__(
        self,
        features: tuple[str, ...],
        prediction: str = "Luteal",
    ) -> None:
        self.feature_names_in_ = features
        self.prediction = prediction
        self.frames: list[pd.DataFrame] = []

    def predict(self, frame: pd.DataFrame) -> list[str]:
        self.frames.append(frame.copy())
        return [self.prediction]


def v01_features(usable_days: float = 7) -> dict[str, float | None]:
    features: dict[str, float | None] = {name: 0.0 for name in V01_FEATURE_NAMES}
    features["lookback_observed_days"] = usable_days
    return features


def account_for_token(session: Any, token: str) -> Account:
    account = session.scalar(select(Account).where(Account.token_hash == hash_secret(token)))
    assert account is not None
    return account


def wearable_day(
    account_id: str,
    observed_date: date,
    *,
    sleep_minutes: int | None = None,
    resting_heart_rate_bpm: float | None = None,
    hrv_ms: float | None = None,
    hrv_method: str | None = None,
) -> WearableDailySummary:
    return WearableDailySummary(
        account_id=account_id,
        observed_date=observed_date,
        platform="health_connect",
        sleep_minutes=sleep_minutes,
        resting_heart_rate_bpm=resting_heart_rate_bpm,
        hrv_ms=hrv_ms,
        hrv_method=hrv_method,
    )


def test_v01_metadata_and_prediction_are_public(client: TestClient) -> None:
    model = RecordingModel(V01_FEATURE_NAMES, "Follicular")
    client.app.state.phase_model_v01 = model

    metadata = client.get("/v1/models/mcphases-phase-v0.1")
    assert metadata.status_code == 200
    assert metadata.json()["status"] == "ready"
    assert metadata.json()["feature_names"] == list(V01_FEATURE_NAMES)
    assert metadata.json()["feature_count"] == 161
    assert metadata.json()["prediction_timestamp"] == "Start of the target calendar day"
    assert len(metadata.json()["limitations"]) == 3

    first = client.post(
        "/v1/models/mcphases-phase-v0.1/predict",
        json={"features": v01_features()},
    )
    second = client.post(
        "/v1/models/mcphases-phase-v0.1/predict",
        json={"features": v01_features()},
    )
    assert first.status_code == 200
    assert first.json() == second.json()
    assert first.json()["predicted_phase"] == "Follicular"
    assert "probability" not in first.json()
    assert list(model.frames[0].columns) == list(V01_FEATURE_NAMES)


def test_v01_rejects_invalid_feature_contract_and_nonfinite_values(
    client: TestClient,
) -> None:
    client.app.state.phase_model_v01 = RecordingModel(V01_FEATURE_NAMES)
    missing = v01_features()
    missing.pop("rhr_value__mean7")
    assert client.post(
        "/v1/models/mcphases-phase-v0.1/predict",
        json={"features": missing},
    ).status_code == 422

    renamed = v01_features()
    renamed["renamed_feature"] = renamed.pop("rhr_value__mean7")
    assert client.post(
        "/v1/models/mcphases-phase-v0.1/predict",
        json={"features": renamed},
    ).status_code == 422

    nonfinite = v01_features()
    nonfinite["rhr_value__mean7"] = "Infinity"
    assert client.post(
        "/v1/models/mcphases-phase-v0.1/predict",
        json={"features": nonfinite},
    ).status_code == 422

    numeric_string = v01_features()
    numeric_string["rhr_value__mean7"] = "1"  # type: ignore[assignment]
    assert client.post(
        "/v1/models/mcphases-phase-v0.1/predict",
        json={"features": numeric_string},
    ).status_code == 422

    boolean = v01_features()
    boolean["rhr_value__mean7"] = True
    assert client.post(
        "/v1/models/mcphases-phase-v0.1/predict",
        json={"features": boolean},
    ).status_code == 422


def test_v01_reports_insufficient_data_and_missing_model(client: TestClient) -> None:
    client.app.state.phase_model_v01 = RecordingModel(V01_FEATURE_NAMES)
    insufficient = client.post(
        "/v1/models/mcphases-phase-v0.1/predict",
        json={"features": v01_features(3)},
    )
    assert insufficient.json()["status"] == "insufficient_data"
    assert insufficient.json()["predicted_phase"] is None

    client.app.state.phase_model_v01 = None
    unavailable = client.post(
        "/v1/models/mcphases-phase-v0.1/predict",
        json={"features": v01_features()},
    )
    assert unavailable.json()["status"] == "model_unavailable"


def test_v02_feature_builder_uses_population_sd_and_never_converts_sdnn() -> None:
    rows = [
        wearable_day(
            "account",
            date(2026, 7, 10),
            resting_heart_rate_bpm=60,
            hrv_ms=40,
            hrv_method="rmssd",
        ),
        wearable_day(
            "account",
            date(2026, 7, 11),
            resting_heart_rate_bpm=64,
            hrv_ms=99,
            hrv_method="sdnn",
        ),
    ]
    features, usable_days = build_v02_features(rows)
    assert usable_days == 2
    assert features["resting_heart_rate_bpm__mean7"] == 62
    assert features["resting_heart_rate_bpm__sd7"] == 2
    assert features["hrv_rmssd_ms__mean7"] == 40
    assert features["hrv_rmssd_ms__n7"] == 1
    assert tuple(features) == V02_FEATURE_NAMES

    sdnn_only, sdnn_usable_days = build_v02_features(
        [wearable_day("account", date(2026, 7, 12), hrv_ms=99, hrv_method="sdnn")]
    )
    assert sdnn_usable_days == 0
    assert sdnn_only["hrv_rmssd_ms__n7"] == 0


def test_v02_route_is_authenticated_isolated_and_uses_only_t_minus_7_to_t_minus_1(
    client: TestClient,
    enroll,
    session_factory,
) -> None:
    first_token = enroll()
    second_token = enroll()
    target = date.today()
    model = RecordingModel(V02_FEATURE_NAMES, "Menstrual")
    client.app.state.phase_model_v02 = model

    with session_factory() as session:
        first = account_for_token(session, first_token)
        second = account_for_token(session, second_token)
        session.add(
            wearable_day(
                first.id,
                target - timedelta(days=8),
                resting_heart_rate_bpm=999,
            )
        )
        session.add(
            wearable_day(
                first.id,
                target - timedelta(days=7),
                hrv_ms=500,
                hrv_method="sdnn",
            )
        )
        for offset, value in zip(range(6, 2, -1), (40, 42, 44, 46), strict=True):
            session.add(
                wearable_day(
                    first.id,
                    target - timedelta(days=offset),
                    resting_heart_rate_bpm=value,
                    hrv_ms=value,
                    hrv_method="rmssd",
                )
            )
        session.add(
            wearable_day(
                first.id,
                target,
                resting_heart_rate_bpm=888,
                hrv_ms=888,
                hrv_method="rmssd",
            )
        )
        for offset in range(1, 8):
            session.add(
                wearable_day(
                    second.id,
                    target - timedelta(days=offset),
                    resting_heart_rate_bpm=777,
                    hrv_ms=777,
                    hrv_method="rmssd",
                )
            )
        session.commit()

    assert client.get(
        f"/v1/research/phase-forecast?target_date={target.isoformat()}"
    ).status_code == 401
    response = client.get(
        f"/v1/research/phase-forecast?target_date={target.isoformat()}",
        headers=auth(first_token),
    )
    repeated = client.get(
        f"/v1/research/phase-forecast?target_date={target.isoformat()}",
        headers=auth(first_token),
    )
    assert response.status_code == 200
    assert repeated.json() == response.json()
    assert response.json()["status"] == "ready"
    assert response.json()["predicted_phase"] == "Menstrual"
    assert response.json()["usable_days"] == 4
    assert "probability" not in response.json()

    frame = model.frames[0]
    assert list(frame.columns) == list(V02_FEATURE_NAMES)
    assert frame.iloc[0]["resting_heart_rate_bpm__mean7"] == 43
    assert frame.iloc[0]["resting_heart_rate_bpm__max7"] == 46
    assert frame.iloc[0]["hrv_rmssd_ms__n7"] == 4


def test_v02_model_failure_is_closed_and_does_not_break_symptom_forecast(
    client: TestClient,
    enroll,
    session_factory,
) -> None:
    token = enroll()
    target = date.today()
    with session_factory() as session:
        account = account_for_token(session, token)
        for offset in range(1, 5):
            session.add(
                wearable_day(
                    account.id,
                    target - timedelta(days=offset),
                    sleep_minutes=420,
                )
            )
        session.commit()

    client.app.state.phase_model_v02 = RecordingModel(("wrong_feature",))
    phase = client.get(
        f"/v1/research/phase-forecast?target_date={target.isoformat()}",
        headers=auth(token),
    )
    assert phase.status_code == 200
    assert phase.json()["status"] == "model_unavailable"

    client.app.state.phase_model_v02 = None
    missing = client.get(
        f"/v1/research/phase-forecast?target_date={target.isoformat()}",
        headers=auth(token),
    )
    assert missing.json()["status"] == "model_unavailable"
    assert client.get("/v1/forecast", headers=auth(token)).status_code == 200


def test_v02_route_requires_four_usable_days(
    client: TestClient,
    enroll,
    session_factory,
) -> None:
    token = enroll()
    target = date.today()
    client.app.state.phase_model_v02 = RecordingModel(V02_FEATURE_NAMES)
    with session_factory() as session:
        account = account_for_token(session, token)
        for offset in range(1, 4):
            session.add(
                wearable_day(
                    account.id,
                    target - timedelta(days=offset),
                    sleep_minutes=420,
                )
            )
        session.commit()

    response = client.get(
        f"/v1/research/phase-forecast?target_date={target.isoformat()}",
        headers=auth(token),
    )
    assert response.status_code == 200
    assert response.json()["status"] == "insufficient_data"
    assert response.json()["usable_days"] == 3
