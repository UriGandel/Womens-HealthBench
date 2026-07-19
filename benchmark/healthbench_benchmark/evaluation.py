"""Evaluation protocols and baseline comparisons."""

from __future__ import annotations

import json
import platform
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import Pipeline

from .features import FEATURE_COLUMNS, build_features

CYCLE_FEATURES = ("cycle_day_sin", "cycle_day_cos", "period_flow", "period_spotting")
MODEL_VERSION = "healthbench-synthetic-gb-0.1.0"


def _estimator(kind: str) -> Pipeline:
    columns = list(CYCLE_FEATURES if kind == "cycle_logistic" else FEATURE_COLUMNS)
    transform = ColumnTransformer(
        [("numeric", SimpleImputer(strategy="median", add_indicator=True), columns)],
        remainder="drop",
    )
    if kind == "cycle_logistic":
        model = LogisticRegression(max_iter=1000, class_weight="balanced", random_state=17)
    elif kind == "gradient_boosting":
        model = HistGradientBoostingClassifier(
            max_iter=120,
            max_leaf_nodes=15,
            learning_rate=0.06,
            l2_regularization=0.5,
            random_state=17,
        )
    else:
        raise ValueError(f"unknown estimator: {kind}")
    return Pipeline([("prepare", transform), ("model", model)])


def _fit_predict(kind: str, train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    if train["target"].nunique() < 2:
        return np.full(len(test), float(train["target"].mean()))
    estimator = _estimator(kind)
    estimator.fit(train, train["target"])
    return estimator.predict_proba(test)[:, 1]


def _causal_participant_rate(frame: pd.DataFrame, prior: float) -> np.ndarray:
    rates = pd.Series(index=frame.index, dtype=float)
    for _, group in frame.groupby("participant_id", sort=False):
        ordered = group.sort_values("feature_day")
        expanding_sum = ordered["target"].shift(1).fillna(0).cumsum()
        observations = np.arange(len(ordered), dtype=float)
        smoothed = (expanding_sum + 2 * prior) / (observations + 2)
        rates.loc[ordered.index] = smoothed.to_numpy()
    return rates.loc[frame.index].to_numpy()


def _metrics(y_true: Iterable[int], probability: Iterable[float]) -> dict[str, Any]:
    y = np.asarray(list(y_true), dtype=int)
    p = np.clip(np.asarray(list(probability), dtype=float), 0, 1)
    result: dict[str, Any] = {
        "n": int(len(y)),
        "positive_rate": round(float(y.mean()), 6),
        "brier": round(float(brier_score_loss(y, p)), 6),
    }
    if np.unique(y).size == 2:
        result["auroc"] = round(float(roc_auc_score(y, p)), 6)
        result["auprc"] = round(float(average_precision_score(y, p)), 6)
    else:
        result["auroc"] = None
        result["auprc"] = None

    bins = np.minimum((p * 10).astype(int), 9)
    calibration = []
    ece = 0.0
    for bin_index in range(10):
        selected = bins == bin_index
        if not selected.any():
            continue
        predicted = float(p[selected].mean())
        observed = float(y[selected].mean())
        count = int(selected.sum())
        ece += count / len(y) * abs(predicted - observed)
        calibration.append(
            {
                "lower": bin_index / 10,
                "upper": (bin_index + 1) / 10,
                "count": count,
                "mean_predicted": round(predicted, 6),
                "observed_rate": round(observed, 6),
            }
        )
    result["calibration_error"] = round(ece, 6)
    result["calibration"] = calibration
    return result


def _grouped_predictions(frame: pd.DataFrame, folds: int) -> dict[str, np.ndarray]:
    predictions = {
        name: np.full(len(frame), np.nan)
        for name in (
            "previous_day_burden",
            "participant_historical_rate",
            "cycle_logistic",
            "gradient_boosting",
        )
    }
    splitter = GroupKFold(n_splits=min(folds, frame["participant_id"].nunique()))
    for train_positions, test_positions in splitter.split(
        frame, frame["target"], frame["participant_id"]
    ):
        train = frame.iloc[train_positions]
        test = frame.iloc[test_positions]
        if set(train["participant_id"]) & set(test["participant_id"]):
            raise AssertionError("participant-group leakage detected")
        prior = float(train["target"].mean())
        predictions["previous_day_burden"][test_positions] = test["current_burden"]
        predictions["participant_historical_rate"][test_positions] = _causal_participant_rate(
            test, prior
        )
        for name in ("cycle_logistic", "gradient_boosting"):
            predictions[name][test_positions] = _fit_predict(name, train, test)
    return predictions


def _rolling_predictions(
    frame: pd.DataFrame, train_fraction: float = 0.7
) -> tuple[pd.DataFrame, dict[str, np.ndarray]]:
    test_parts: list[pd.DataFrame] = []
    prediction_parts: dict[str, list[np.ndarray]] = {
        name: []
        for name in (
            "previous_day_burden",
            "participant_historical_rate",
            "cycle_logistic",
            "gradient_boosting",
        )
    }
    for _, participant in frame.groupby("participant_id", sort=True):
        ordered = participant.sort_values("feature_day")
        split_at = max(7, int(len(ordered) * train_fraction))
        if split_at >= len(ordered):
            continue
        train, test = ordered.iloc[:split_at], ordered.iloc[split_at:]
        if train["target_day"].max() >= test["target_day"].min():
            raise AssertionError("temporal leakage detected")
        test_parts.append(test)
        prediction_parts["previous_day_burden"].append(test["current_burden"].to_numpy())
        # At test time the rate starts with the participant's causal training history,
        # then incorporates only outcomes observed before each prediction.
        prior_sum = float(train["target"].sum())
        prior_count = len(train)
        cumulative = test["target"].shift(1).fillna(0).cumsum().to_numpy()
        offsets = np.arange(len(test), dtype=float)
        prediction_parts["participant_historical_rate"].append(
            (prior_sum + cumulative) / (prior_count + offsets)
        )
        for name in ("cycle_logistic", "gradient_boosting"):
            prediction_parts[name].append(_fit_predict(name, train, test))

    combined = pd.concat(test_parts, ignore_index=True)
    return combined, {name: np.concatenate(parts) for name, parts in prediction_parts.items()}


def _missingness(frame: pd.DataFrame) -> dict[str, float]:
    return {
        column: round(float(frame[column].isna().mean()), 6)
        for column in FEATURE_COLUMNS
    }


def run_benchmark(
    records: Iterable[dict[str, Any]],
    *,
    grouped_folds: int = 5,
) -> dict[str, Any]:
    """Run both predefined evaluation protocols and return JSON-safe results."""
    features = build_features(records)
    if features["participant_id"].nunique() < 2:
        raise ValueError("grouped evaluation requires at least two participants")
    if grouped_folds < 2:
        raise ValueError("grouped_folds must be at least 2")

    grouped = _grouped_predictions(features, grouped_folds)
    rolling_frame, rolling = _rolling_predictions(features)
    grouped_metrics = {
        name: _metrics(features["target"], values) for name, values in grouped.items()
    }
    rolling_metrics = {
        name: _metrics(rolling_frame["target"], values) for name, values in rolling.items()
    }
    per_participant = {
        participant_id: {
            name: _metrics(
                participant_frame["target"],
                values[participant_frame.index.to_numpy()],
            )
            for name, values in {
                key: pd.Series(value, index=rolling_frame.index) for key, value in rolling.items()
            }.items()
        }
        for participant_id, participant_frame in rolling_frame.groupby("participant_id")
    }
    gb = grouped_metrics["gradient_boosting"]
    baselines = [
        grouped_metrics["previous_day_burden"],
        grouped_metrics["participant_historical_rate"],
        grouped_metrics["cycle_logistic"],
    ]
    baseline_aurocs = [
        float(baseline["auroc"])
        for baseline in baselines
        if baseline["auroc"] is not None
    ]
    beats_best_discrimination = (
        gb["auroc"] is not None
        and baseline_aurocs
        and float(gb["auroc"]) > max(baseline_aurocs)
    )
    beats_best_brier = float(gb["brier"]) < min(
        float(baseline["brier"]) for baseline in baselines
    )
    supported = bool(
        (beats_best_discrimination or beats_best_brier)
        and float(gb["calibration_error"])
        <= min(float(baseline["calibration_error"]) for baseline in baselines)
    )

    return {
        "benchmark_version": "1.0.0",
        "model_version": MODEL_VERSION,
        "generated_at": datetime.now(UTC).isoformat(),
        "data": {
            "source": sorted(features.get("source", pd.Series(["unknown"])).unique().tolist()),
            "participants": int(features["participant_id"].nunique()),
            "prediction_rows": int(len(features)),
            "positive_rate": round(float(features["target"].mean()), 6),
            "missingness": _missingness(features),
        },
        "target": "mean next-day normalized symptom severity >= 0.5",
        "protocols": {
            "participant_grouped_cross_validation": {
                "folds": min(grouped_folds, int(features["participant_id"].nunique())),
                "models": grouped_metrics,
            },
            "per_participant_rolling_temporal_holdout": {
                "train_fraction": 0.7,
                "models": rolling_metrics,
                "per_participant": per_participant,
            },
        },
        "predictive_claim_supported": supported,
        "claim_policy": (
            "Experimental predictive result"
            if supported
            else "Data infrastructure; model remains experimental"
        ),
        "runtime": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "pandas": pd.__version__,
        },
    }


def write_report(report: dict[str, Any], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
