from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from math import nan
from pathlib import Path
from typing import Any, Literal, cast

import joblib
import pandas as pd

from app.models import WearableDailySummary

PhaseLabel = Literal["Fertility", "Follicular", "Luteal", "Menstrual"]
PhaseStatus = Literal["ready", "insufficient_data", "model_unavailable"]

PHASE_CLASSES: tuple[PhaseLabel, ...] = (
    "Fertility",
    "Follicular",
    "Luteal",
    "Menstrual",
)
LOOKBACK_DAYS = 7
REQUIRED_DAYS = 4
ROLLING_STATISTICS = ("mean7", "sd7", "min7", "max7", "n7")
PHASE_DISCLAIMER = (
    "Research estimate only—not medical advice, fertility guidance, contraception "
    "guidance, ovulation confirmation, or diagnosis."
)

V01_DAILY_FEATURES = (
    "act_sedentary_minutes",
    "act_light_minutes",
    "act_moderate_minutes",
    "act_very_active_minutes",
    "activity_source_rows",
    "rhr_value",
    "rhr_error",
    "resting_hr_source_rows",
    "hrv_rmssd",
    "hrv_coverage",
    "hrv_low_frequency",
    "hrv_high_frequency",
    "hrv_source_rows",
    "sleep_duration",
    "sleep_minutes_to_fall_asleep",
    "sleep_minutes_asleep",
    "sleep_minutes_awake",
    "sleep_minutes_after_wakeup",
    "sleep_time_in_bed",
    "sleep_efficiency",
    "sleep_source_rows",
    "resp_full_sleep_rate",
    "resp_deep_sleep_rate",
    "resp_light_sleep_rate",
    "resp_rem_sleep_rate",
    "respiratory_source_rows",
    "temp_samples",
    "temp_nightly",
    "temp_baseline_sum",
    "temp_nightly_sd",
    "temp_sample_sd",
    "temperature_source_rows",
)
V02_DAILY_FEATURES = (
    "resting_heart_rate_bpm",
    "hrv_rmssd_ms",
    "sleep_minutes",
    "respiratory_rate_bpm",
    "peripheral_temperature_delta_c",
)


def rolling_feature_names(daily_features: Sequence[str]) -> tuple[str, ...]:
    return (
        "lookback_observed_days",
        *(
            f"{feature}__{statistic}"
            for feature in daily_features
            for statistic in ROLLING_STATISTICS
        ),
    )


V01_FEATURE_NAMES = rolling_feature_names(V01_DAILY_FEATURES)
V02_FEATURE_NAMES = rolling_feature_names(V02_DAILY_FEATURES)


@dataclass(frozen=True)
class PhasePrediction:
    status: PhaseStatus
    predicted_phase: PhaseLabel | None
    usable_days: int


def load_phase_model(path: str | None, expected_features: Sequence[str]) -> Any | None:
    if path is None:
        return None
    target = Path(path).expanduser()
    if not target.is_file():
        return None
    try:
        model = joblib.load(target)
        names = tuple(str(value) for value in model.feature_names_in_)
        classes = tuple(str(value) for value in model.classes_)
    except Exception:
        return None
    if names != tuple(expected_features) or classes != PHASE_CLASSES:
        return None
    return model


def predict_v01(
    model: Any | None,
    supplied_features: Mapping[str, float | None],
) -> PhasePrediction:
    usable_days_value = supplied_features.get("lookback_observed_days")
    usable_days = int(usable_days_value) if usable_days_value is not None else 0
    if usable_days < REQUIRED_DAYS:
        return PhasePrediction("insufficient_data", None, usable_days)
    if model is None:
        return PhasePrediction("model_unavailable", None, usable_days)
    ordered = {name: supplied_features[name] for name in V01_FEATURE_NAMES}
    return _predict(model, ordered, V01_FEATURE_NAMES, usable_days)


def build_v02_features(
    rows: Sequence[WearableDailySummary],
) -> tuple[dict[str, float], int]:
    daily_values: dict[str, list[float]] = {
        feature: [] for feature in V02_DAILY_FEATURES
    }
    usable_days = 0
    for row in rows:
        values: dict[str, float | None] = {
            "resting_heart_rate_bpm": row.resting_heart_rate_bpm,
            "hrv_rmssd_ms": row.hrv_ms if row.hrv_method == "rmssd" else None,
            "sleep_minutes": float(row.sleep_minutes) if row.sleep_minutes is not None else None,
            "respiratory_rate_bpm": row.respiratory_rate_bpm,
            "peripheral_temperature_delta_c": row.peripheral_temperature_delta_c,
        }
        if any(value is not None for value in values.values()):
            usable_days += 1
        for feature, value in values.items():
            if value is not None:
                daily_values[feature].append(float(value))

    features: dict[str, float] = {"lookback_observed_days": float(usable_days)}
    for feature in V02_DAILY_FEATURES:
        values = daily_values[feature]
        series = pd.Series(values, dtype="float64")
        features[f"{feature}__mean7"] = float(series.mean()) if values else nan
        features[f"{feature}__sd7"] = float(series.std(ddof=0)) if values else nan
        features[f"{feature}__min7"] = float(series.min()) if values else nan
        features[f"{feature}__max7"] = float(series.max()) if values else nan
        features[f"{feature}__n7"] = float(len(values))
    return features, usable_days


def predict_v02(
    model: Any | None,
    rows: Sequence[WearableDailySummary],
) -> PhasePrediction:
    features, usable_days = build_v02_features(rows)
    if usable_days < REQUIRED_DAYS:
        return PhasePrediction("insufficient_data", None, usable_days)
    if model is None:
        return PhasePrediction("model_unavailable", None, usable_days)
    return _predict(model, features, V02_FEATURE_NAMES, usable_days)


def _predict(
    model: Any,
    features: Mapping[str, float | None],
    expected_features: Sequence[str],
    usable_days: int,
) -> PhasePrediction:
    frame = pd.DataFrame([features])
    try:
        model_features = tuple(str(value) for value in model.feature_names_in_)
        generated_features = tuple(str(value) for value in frame.columns)
    except Exception:
        return PhasePrediction("model_unavailable", None, usable_days)
    if (
        len(generated_features) != len(model_features)
        or set(generated_features) != set(model_features)
        or model_features != tuple(expected_features)
    ):
        return PhasePrediction("model_unavailable", None, usable_days)
    frame = frame.loc[:, list(model_features)]
    try:
        predicted = str(model.predict(frame)[0])
    except Exception:
        return PhasePrediction("model_unavailable", None, usable_days)
    if predicted not in PHASE_CLASSES:
        return PhasePrediction("model_unavailable", None, usable_days)
    return PhasePrediction("ready", cast(PhaseLabel, predicted), usable_days)
