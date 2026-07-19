"""Causal feature construction for next-day symptom burden."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import numpy as np
import pandas as pd

SYMPTOMS = ("fatigue", "brain_fog", "headache", "pelvic_pain", "mood_disruption")
CORE_FEATURE_COLUMNS = (
    "current_burden",
    "burden_mean_3d",
    "burden_mean_7d",
    "sleep_hours",
    "sleep_quality",
    "stress",
    "cycle_day_sin",
    "cycle_day_cos",
    "period_flow",
    "period_spotting",
)
WEARABLE_FEATURE_COLUMNS = (
    "wearable_sleep_hours",
    "steps",
    "activity_minutes",
    "active_energy_kcal",
    "resting_heart_rate_bpm",
    "hrv_sdnn_z",
    "hrv_rmssd_z",
    "respiratory_rate_bpm",
    "oxygen_saturation_pct",
    "peripheral_temperature_delta_c",
)
FEATURE_COLUMNS = (*CORE_FEATURE_COLUMNS, *WEARABLE_FEATURE_COLUMNS)


def _causal_zscore(values: pd.Series) -> pd.Series:
    expanding = values.expanding(min_periods=2)
    mean_to_date = expanding.mean()
    standard_deviation = expanding.std(ddof=0).replace(0, np.nan)
    return (values - mean_to_date) / standard_deviation


def build_features(records: Iterable[dict[str, Any]]) -> pd.DataFrame:
    """Create day-t features for a day-(t+1) target.

    ``feature_day`` and ``target_day`` are retained as explicit provenance and
    are never passed to the estimators.
    """
    frame = pd.DataFrame(records)
    required = {
        "participant_id",
        "day_in_study",
        "has_self_report",
        "has_wearable",
        "period_status",
        *SYMPTOMS,
    }
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"records are missing required columns: {sorted(missing)}")

    frame = frame.sort_values(["participant_id", "day_in_study"]).reset_index(drop=True)
    if frame.duplicated(["participant_id", "day_in_study"]).any():
        raise ValueError("participant_id/day_in_study pairs must be unique")

    frame["current_burden"] = frame[list(SYMPTOMS)].mean(axis=1) / 4.0
    frame.loc[~frame["has_self_report"], "current_burden"] = np.nan
    grouped = frame.groupby("participant_id", sort=False)
    frame["target_burden"] = grouped["current_burden"].shift(-1)
    frame["target_day"] = grouped["day_in_study"].shift(-1)
    frame["target_has_self_report"] = grouped["has_self_report"].shift(-1)
    frame["feature_day"] = frame["day_in_study"]
    frame["burden_mean_3d"] = grouped["current_burden"].transform(
        lambda values: values.rolling(3, min_periods=1).mean()
    )
    frame["burden_mean_7d"] = grouped["current_burden"].transform(
        lambda values: values.rolling(7, min_periods=1).mean()
    )
    cycle_radians = 2 * 3.141592653589793 * (frame["cycle_day"] - 1) / 28
    # Keep nullable cycle features as float64/NaN. ``pd.NA`` would coerce these
    # columns to object dtype, which scikit-learn cannot pass to its imputer.
    frame["cycle_day_sin"] = np.sin(cycle_radians.astype(float))
    frame["cycle_day_cos"] = np.cos(cycle_radians.astype(float))
    frame["period_flow"] = (frame["period_status"] == "flow").astype(int)
    frame["period_spotting"] = (frame["period_status"] == "spotting").astype(int)
    frame["wearable_sleep_hours"] = frame["wearable_sleep_minutes"] / 60.0

    frame["hrv_sdnn_ms"] = frame["hrv_ms"].where(frame["hrv_method"] == "sdnn")
    frame["hrv_rmssd_ms"] = frame["hrv_ms"].where(frame["hrv_method"] == "rmssd")
    frame["hrv_sdnn_z"] = frame.groupby("participant_id", sort=False)[
        "hrv_sdnn_ms"
    ].transform(_causal_zscore)
    frame["hrv_rmssd_z"] = frame.groupby("participant_id", sort=False)[
        "hrv_rmssd_ms"
    ].transform(_causal_zscore)
    frame["target"] = (frame["target_burden"] >= 0.5).astype("Int64")
    consecutive = frame["target_day"] == frame["feature_day"] + 1
    frame = frame[
        frame["target_burden"].notna()
        & frame["target_day"].notna()
        & frame["target_has_self_report"].eq(True)
        & consecutive
    ].copy()
    frame["target"] = frame["target"].astype(int)

    if not (frame["feature_day"] < frame["target_day"]).all():
        raise AssertionError("feature provenance violation: every feature must predate its target")
    return frame
