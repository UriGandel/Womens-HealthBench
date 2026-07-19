#!/usr/bin/env python3
"""Build mcPHASES Benchmark v0.1 and train reproducible baseline models.

Task: predict the current participant-day menstrual phase from the previous
seven complete calendar days of passive wearable summaries. Hormones,
self-reports, current-day wearable data, and participant identity are never
model features.

The script reads restricted mcPHASES files locally. Private participant-day
examples, pseudonymous split assignments, models, and row-level predictions
remain under OUTPUT_DIR/private. The small results ZIP contains aggregate
documentation and metrics only.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import platform
import shutil
import sys
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

try:
    import duckdb
    import joblib
    import numpy as np
    import pandas as pd
    import sklearn
    from sklearn.dummy import DummyClassifier
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import (
        accuracy_score,
        balanced_accuracy_score,
        classification_report,
        confusion_matrix,
        f1_score,
        log_loss,
    )
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "Install dependencies first: pip install duckdb pandas pyarrow "
        "scikit-learn joblib"
    ) from exc


VERSION = "0.1.0"
SEED_DEFAULT = 20260719
LOOKBACK_DAYS = 7
MIN_OBSERVED_DAYS = 4
# Lexicographic order is required by scikit-learn's multiclass probability metrics.
CLASSES = ["Fertility", "Follicular", "Luteal", "Menstrual"]
TARGET_FILE = "hormones_and_selfreport.csv"


def qident(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def qstr(value: str | Path) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def source_sql(path: Path) -> str:
    return (
        "read_csv_auto("
        f"{qstr(path)}, header=true, all_varchar=true, nullstr='', "
        "ignore_errors=false, parallel=true)"
    )


def numeric(column: str) -> str:
    return f"TRY_CAST(NULLIF(trim({qident(column)}), '') AS DOUBLE)"


def day(column: str) -> str:
    return f"TRY_CAST(NULLIF(trim({qident(column)}), '') AS INTEGER)"


def stable_float(value: Any) -> Any:
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return round(value, 8)
    if isinstance(value, dict):
        return {str(key): stable_float(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [stable_float(item) for item in value]
    if isinstance(value, np.generic):
        return stable_float(value.item())
    return value


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(stable_float(value), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def sha256_file(path: Path, block_size: int = 8 * 1024 * 1024) -> str:
    result = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(block_size):
            result.update(block)
    return result.hexdigest()


def participant_key(raw_id: Any) -> str:
    material = f"mcphases-benchmark-{VERSION}|{raw_id}".encode("utf-8")
    return hashlib.sha256(material).hexdigest()[:16]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--temp-dir", required=True, type=Path)
    parser.add_argument("--seed", type=int, default=SEED_DEFAULT)
    parser.add_argument("--threads", type=int, default=min(4, os.cpu_count() or 1))
    parser.add_argument("--memory-limit", default="6GB")
    parser.add_argument(
        "--allow-missing-modalities",
        action="store_true",
        help="Development-only: skip unavailable modalities. Do not use for the official run.",
    )
    return parser.parse_args()


def validate_paths(args: argparse.Namespace) -> tuple[Path, Path, Path]:
    data_dir = args.data_dir.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()
    temp_dir = args.temp_dir.expanduser().resolve()
    if not data_dir.is_dir():
        raise SystemExit(f"Data directory does not exist: {data_dir}")
    if data_dir == output_dir or output_dir.is_relative_to(data_dir):
        raise SystemExit("Output directory must be outside the restricted source directory.")
    output_dir.mkdir(parents=True, exist_ok=True)
    temp_dir.mkdir(parents=True, exist_ok=True)
    (temp_dir / "spill").mkdir(parents=True, exist_ok=True)
    return data_dir, output_dir, temp_dir


def median_expr(source_column: str, output_column: str) -> str:
    return f"median({numeric(source_column)}) AS {qident(output_column)}"


def create_daily_tables(
    con: duckdb.DuckDBPyConnection,
    data_dir: Path,
    allow_missing: bool,
) -> tuple[list[str], list[str], list[dict[str, Any]]]:
    """Create one deterministic daily summary table per passive modality."""

    modality_specs: list[dict[str, Any]] = [
        {
            "name": "activity",
            "file": "active_minutes.csv",
            "day": "day_in_study",
            "features": {
                "sedentary": "act_sedentary_minutes",
                "lightly": "act_light_minutes",
                "moderately": "act_moderate_minutes",
                "very": "act_very_active_minutes",
            },
        },
        {
            "name": "resting_hr",
            "file": "resting_heart_rate.csv",
            "day": "day_in_study",
            "features": {
                "value": "rhr_value",
                "error": "rhr_error",
            },
        },
        {
            "name": "hrv",
            "file": "heart_rate_variability_details.csv",
            "day": "day_in_study",
            "features": {
                "rmssd": "hrv_rmssd",
                "coverage": "hrv_coverage",
                "low_frequency": "hrv_low_frequency",
                "high_frequency": "hrv_high_frequency",
            },
        },
        {
            "name": "sleep",
            "file": "sleep.csv",
            "day": "sleep_end_day_in_study",
            "features": {
                "duration": "sleep_duration",
                "minutestofallasleep": "sleep_minutes_to_fall_asleep",
                "minutesasleep": "sleep_minutes_asleep",
                "minutesawake": "sleep_minutes_awake",
                "minutesafterwakeup": "sleep_minutes_after_wakeup",
                "timeinbed": "sleep_time_in_bed",
                "efficiency": "sleep_efficiency",
            },
        },
        {
            "name": "respiratory",
            "file": "respiratory_rate_summary.csv",
            "day": "day_in_study",
            "features": {
                "full_sleep_breathing_rate": "resp_full_sleep_rate",
                "deep_sleep_breathing_rate": "resp_deep_sleep_rate",
                "light_sleep_breathing_rate": "resp_light_sleep_rate",
                "rem_sleep_breathing_rate": "resp_rem_sleep_rate",
            },
        },
        {
            "name": "temperature",
            "file": "computed_temperature.csv",
            "day": "sleep_end_day_in_study",
            "features": {
                "temperature_samples": "temp_samples",
                "nightly_temperature": "temp_nightly",
                "baseline_relative_sample_sum": "temp_baseline_sum",
                "baseline_relative_nightly_standard_deviation": "temp_nightly_sd",
                "baseline_relative_sample_standard_deviation": "temp_sample_sd",
            },
        },
    ]

    required = [TARGET_FILE] + [spec["file"] for spec in modality_specs]
    missing = [name for name in required if not (data_dir / name).exists()]
    if missing and not allow_missing:
        raise SystemExit("Missing benchmark inputs: " + ", ".join(missing))
    if TARGET_FILE in missing:
        raise SystemExit(f"Required target file is missing: {TARGET_FILE}")

    daily_tables: list[str] = []
    all_features: list[str] = []
    included_specs: list[dict[str, Any]] = []
    for spec in modality_specs:
        path = data_dir / spec["file"]
        if not path.exists():
            print(f"Skipping unavailable development modality: {spec['file']}", flush=True)
            continue

        name = spec["name"]
        table = f"daily_{name}"
        feature_sql = [
            median_expr(source, output)
            for source, output in spec["features"].items()
        ]
        row_feature = f"{name}_source_rows"
        feature_sql.append(f"COUNT(*)::DOUBLE AS {qident(row_feature)}")
        query = f"""
            CREATE OR REPLACE TEMP TABLE {qident(table)} AS
            WITH exact_dedup AS (
                SELECT DISTINCT * FROM {source_sql(path)}
            )
            SELECT
                CAST(id AS VARCHAR) AS id,
                CAST(study_interval AS VARCHAR) AS study_interval,
                {day(spec['day'])} AS feature_day,
                {', '.join(feature_sql)}
            FROM exact_dedup
            WHERE id IS NOT NULL
              AND study_interval IS NOT NULL
              AND {day(spec['day'])} IS NOT NULL
            GROUP BY id, study_interval, feature_day
        """
        print(f"Aggregating {spec['file']} ...", flush=True)
        con.execute(query)
        daily_tables.append(table)
        all_features.extend(spec["features"].values())
        all_features.append(row_feature)
        included_specs.append(spec)

    if len(daily_tables) < 3:
        raise SystemExit("Fewer than three passive modalities are available.")
    return daily_tables, all_features, included_specs


def create_targets(con: duckdb.DuckDBPyConnection, target_path: Path) -> dict[str, int]:
    source = source_sql(target_path)
    con.execute(
        f"""
        CREATE OR REPLACE TEMP TABLE targets AS
        WITH normalized AS (
            SELECT
                CAST(id AS VARCHAR) AS id,
                CAST(study_interval AS VARCHAR) AS study_interval,
                {day('day_in_study')} AS target_day,
                CASE lower(trim(phase))
                    WHEN 'menstrual' THEN 'Menstrual'
                    WHEN 'follicular' THEN 'Follicular'
                    WHEN 'fertility' THEN 'Fertility'
                    WHEN 'luteal' THEN 'Luteal'
                    ELSE NULL
                END AS target_phase
            FROM {source}
        )
        SELECT
            id,
            study_interval,
            target_day,
            max(target_phase) AS target_phase,
            COUNT(DISTINCT target_phase) AS distinct_labels
        FROM normalized
        WHERE id IS NOT NULL
          AND study_interval IS NOT NULL
          AND target_day IS NOT NULL
        GROUP BY id, study_interval, target_day
        """
    )
    conflicts = int(
        con.execute("SELECT COUNT(*) FROM targets WHERE distinct_labels > 1").fetchone()[0]
    )
    if conflicts:
        raise SystemExit(f"Target label conflicts detected for {conflicts} participant-days.")
    counts = dict(
        con.execute(
            """
            SELECT coalesce(target_phase, '<MISSING>'), COUNT(*)
            FROM targets
            GROUP BY target_phase
            ORDER BY 1
            """
        ).fetchall()
    )
    return {str(key): int(value) for key, value in counts.items()}


def combine_daily_tables(
    con: duckdb.DuckDBPyConnection,
    tables: list[str],
    feature_names: list[str],
) -> None:
    keys_sql = " UNION ".join(
        f"SELECT id, study_interval, feature_day FROM {qident(table)}" for table in tables
    )
    joins: list[str] = []
    selections: list[str] = []
    for index, table in enumerate(tables):
        alias = f"m{index}"
        joins.append(
            f"LEFT JOIN {qident(table)} {alias} "
            f"ON {alias}.id = k.id "
            f"AND {alias}.study_interval = k.study_interval "
            f"AND {alias}.feature_day = k.feature_day"
        )
        columns = [row[1] for row in con.execute(f"PRAGMA table_info({qstr(table)})").fetchall()]
        for column in columns:
            if column not in {"id", "study_interval", "feature_day"}:
                selections.append(f"{alias}.{qident(column)} AS {qident(column)}")

    con.execute(
        f"""
        CREATE OR REPLACE TEMP TABLE daily_features AS
        WITH keys AS ({keys_sql})
        SELECT
            k.id,
            k.study_interval,
            k.feature_day,
            {', '.join(selections)}
        FROM keys k
        {' '.join(joins)}
        """
    )
    actual = {
        row[1]
        for row in con.execute("PRAGMA table_info('daily_features')").fetchall()
    }
    missing = sorted(set(feature_names) - actual)
    if missing:
        raise RuntimeError("Combined daily features are missing: " + ", ".join(missing))


def build_examples(
    con: duckdb.DuckDBPyConnection,
    feature_names: list[str],
) -> pd.DataFrame:
    aggregates: list[str] = []
    for feature in feature_names:
        quoted = f"d.{qident(feature)}"
        prefix = qident(feature)
        aggregates.extend(
            [
                f"AVG({quoted}) AS {qident(feature + '__mean7')}",
                f"STDDEV_POP({quoted}) AS {qident(feature + '__sd7')}",
                f"MIN({quoted}) AS {qident(feature + '__min7')}",
                f"MAX({quoted}) AS {qident(feature + '__max7')}",
                f"COUNT({quoted})::DOUBLE AS {qident(feature + '__n7')}",
            ]
        )

    query = f"""
        SELECT
            t.id,
            t.study_interval,
            t.target_day,
            t.target_phase,
            COUNT(DISTINCT d.feature_day)::INTEGER AS lookback_observed_days,
            {', '.join(aggregates)}
        FROM targets t
        LEFT JOIN daily_features d
          ON d.id = t.id
         AND d.study_interval = t.study_interval
         AND d.feature_day BETWEEN t.target_day - {LOOKBACK_DAYS} AND t.target_day - 1
        WHERE t.target_phase IN ({', '.join(qstr(item) for item in CLASSES)})
        GROUP BY t.id, t.study_interval, t.target_day, t.target_phase
        HAVING COUNT(DISTINCT d.feature_day) >= {MIN_OBSERVED_DAYS}
        ORDER BY t.id, t.study_interval, t.target_day
    """
    print("Constructing leakage-safe seven-day examples ...", flush=True)
    result = con.execute(query).fetch_df()
    if result.empty:
        raise SystemExit("No eligible benchmark examples were produced.")
    result["participant_key"] = result["id"].map(participant_key)
    result.drop(columns=["id"], inplace=True)
    first = [
        "participant_key",
        "study_interval",
        "target_day",
        "target_phase",
        "lookback_observed_days",
    ]
    return result[first + [name for name in result.columns if name not in first]]


def assign_splits(frame: pd.DataFrame, seed: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    participants = sorted(
        frame["participant_key"].astype(str).unique(),
        key=lambda key: hashlib.sha256(f"{seed}|{key}".encode("utf-8")).hexdigest(),
    )
    count = len(participants)
    if count < 10:
        raise SystemExit(f"At least 10 participants are required; found {count}.")
    n_train = int(math.floor(0.60 * count))
    n_validation = int(math.floor(0.20 * count))
    assignment: dict[str, str] = {}
    for index, key in enumerate(participants):
        if index < n_train:
            assignment[key] = "train"
        elif index < n_train + n_validation:
            assignment[key] = "validation"
        else:
            assignment[key] = "test"
    frame = frame.copy()
    frame["split"] = frame["participant_key"].map(assignment)
    split_manifest = (
        frame.groupby(["participant_key", "split"], as_index=False)
        .agg(
            examples=("target_phase", "size"),
            study_intervals=("study_interval", "nunique"),
            first_target_day=("target_day", "min"),
            last_target_day=("target_day", "max"),
        )
        .sort_values(["split", "participant_key"])
    )
    leakage = frame.groupby("participant_key")["split"].nunique().max()
    if int(leakage) != 1:
        raise RuntimeError("Participant leakage detected in split assignment.")
    return frame, split_manifest


def probability_matrix(model: Any, x: pd.DataFrame) -> np.ndarray:
    raw = model.predict_proba(x)
    positions = {str(label): index for index, label in enumerate(model.classes_)}
    result = np.zeros((len(x), len(CLASSES)), dtype=float)
    for output_index, label in enumerate(CLASSES):
        if label in positions:
            result[:, output_index] = raw[:, positions[label]]
    row_sums = result.sum(axis=1, keepdims=True)
    row_sums[row_sums == 0] = 1.0
    return result / row_sums


def evaluate(y_true: pd.Series, y_pred: np.ndarray, probability: np.ndarray) -> dict[str, Any]:
    return {
        "examples": int(len(y_true)),
        "class_counts": {label: int((y_true == label).sum()) for label in CLASSES},
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y_true, y_pred)),
        "macro_f1": float(f1_score(y_true, y_pred, labels=CLASSES, average="macro", zero_division=0)),
        "weighted_f1": float(
            f1_score(y_true, y_pred, labels=CLASSES, average="weighted", zero_division=0)
        ),
        "log_loss": float(log_loss(y_true, probability, labels=CLASSES)),
        "classification_report": classification_report(
            y_true,
            y_pred,
            labels=CLASSES,
            output_dict=True,
            zero_division=0,
        ),
        "confusion_matrix": confusion_matrix(y_true, y_pred, labels=CLASSES).tolist(),
        "class_order": CLASSES,
    }


def participant_bootstrap(
    predictions: pd.DataFrame,
    seed: int,
    replicates: int = 1000,
) -> dict[str, Any]:
    rng = np.random.default_rng(seed)
    groups = {
        key: group.index.to_numpy()
        for key, group in predictions.groupby("participant_key", sort=True)
    }
    keys = np.array(sorted(groups), dtype=object)
    estimates: list[float] = []
    for _ in range(replicates):
        sampled = rng.choice(keys, size=len(keys), replace=True)
        indices = np.concatenate([groups[key] for key in sampled])
        sample = predictions.loc[indices]
        estimates.append(
            float(
                f1_score(
                    sample["target_phase"],
                    sample["predicted_phase"],
                    labels=CLASSES,
                    average="macro",
                    zero_division=0,
                )
            )
        )
    return {
        "method": "participant cluster bootstrap",
        "replicates": replicates,
        "seed": seed,
        "macro_f1_ci95": [
            float(np.quantile(estimates, 0.025)),
            float(np.quantile(estimates, 0.975)),
        ],
    }


def train_models(
    frame: pd.DataFrame,
    private_dir: Path,
    seed: int,
) -> tuple[dict[str, Any], dict[str, pd.DataFrame], list[str], list[str]]:
    excluded = {
        "participant_key",
        "study_interval",
        "target_day",
        "target_phase",
        "split",
    }
    candidate_features = [column for column in frame.columns if column not in excluded]
    train = frame[frame["split"] == "train"].copy()
    validation = frame[frame["split"] == "validation"].copy()
    test = frame[frame["split"] == "test"].copy()
    if min(len(train), len(validation), len(test)) == 0:
        raise SystemExit("At least one frozen split is empty.")

    dropped_all_missing = [
        column for column in candidate_features if train[column].notna().sum() == 0
    ]
    features = [column for column in candidate_features if column not in dropped_all_missing]
    if not features:
        raise SystemExit("Every candidate feature is missing in the training split.")

    models: dict[str, Any] = {
        "class_prior": DummyClassifier(strategy="prior"),
        "multinomial_logistic_regression": Pipeline(
            [
                ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
                ("scaler", StandardScaler()),
                (
                    "classifier",
                    LogisticRegression(
                        max_iter=3000,
                        class_weight="balanced",
                        random_state=seed,
                    ),
                ),
            ]
        ),
        "hist_gradient_boosting": Pipeline(
            [
                ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
                (
                    "classifier",
                    HistGradientBoostingClassifier(
                        learning_rate=0.05,
                        max_iter=250,
                        max_leaf_nodes=15,
                        l2_regularization=1.0,
                        random_state=seed,
                    ),
                ),
            ]
        ),
    }

    metrics: dict[str, Any] = {}
    predictions_by_model: dict[str, pd.DataFrame] = {}
    x_train = train[features]
    y_train = train["target_phase"]
    for model_index, (name, model) in enumerate(models.items()):
        print(f"Training baseline: {name}", flush=True)
        model.fit(x_train, y_train)
        joblib.dump(model, private_dir / f"model_{name}.joblib")
        model_metrics: dict[str, Any] = {}
        combined_predictions: list[pd.DataFrame] = []
        for split_name, split_frame in (("validation", validation), ("test", test)):
            x_split = split_frame[features]
            predicted = model.predict(x_split)
            probability = probability_matrix(model, x_split)
            model_metrics[split_name] = evaluate(
                split_frame["target_phase"], predicted, probability
            )
            prediction_frame = split_frame[
                ["participant_key", "study_interval", "target_day", "target_phase", "split"]
            ].copy()
            prediction_frame["predicted_phase"] = predicted
            for class_index, label in enumerate(CLASSES):
                prediction_frame[f"probability_{label.lower()}"] = probability[:, class_index]
            combined_predictions.append(prediction_frame)
        predictions = pd.concat(combined_predictions, ignore_index=True)
        test_predictions = predictions[predictions["split"] == "test"].copy()
        model_metrics["test"]["participant_bootstrap"] = participant_bootstrap(
            test_predictions,
            seed + model_index,
        )
        metrics[name] = model_metrics
        predictions_by_model[name] = predictions
        predictions.to_csv(private_dir / f"predictions_{name}.csv", index=False)
    return metrics, predictions_by_model, features, dropped_all_missing


def task_spec(included_files: list[str], seed: int) -> str:
    return f"""# mcPHASES Benchmark Task v{VERSION}

## Intended task

Predict the current participant-day menstrual phase from passive wearable
summaries observed during the previous {LOOKBACK_DAYS} complete calendar days.

## Prediction contract

- Unit: one participant-study-interval-day.
- Prediction timestamp: start of the labelled target day.
- Lookback: target day minus {LOOKBACK_DAYS} through target day minus 1.
- Outcome classes: {', '.join(CLASSES)}.
- Eligibility: a valid four-class phase label and passive observations on at
  least {MIN_OBSERVED_DAYS} distinct lookback days.
- Included source files: {', '.join(included_files)}.
- Excluded inputs: participant identity, study interval, target-day wearable
  data, hormones, symptom/self-report fields, and phase labels from any input day.
- Exact full-row duplicates are removed within each included source table.
- Non-identical records sharing a candidate timestamp/day are preserved and
  reduced with a prespecified daily median; source-row counts remain features.
- Across the seven-day window each daily feature is summarized by mean,
  population standard deviation, minimum, maximum, and nonmissing-day count.

## Frozen split

Participants are deterministically assigned approximately 60%/20%/20% to
train/validation/test using seed {seed}. Every study interval belonging
to a participant remains in one split. No participant appears in multiple splits.

## Evaluation

- Primary metric: macro-F1.
- Secondary: balanced accuracy, accuracy, weighted F1, per-class recall,
  log loss, and confusion matrix.
- Test uncertainty: 1,000-replicate participant-cluster bootstrap interval for
  macro-F1.
- Baselines: class-prior, class-balanced multinomial logistic regression, and
  histogram gradient-boosted trees.

## Prohibited interpretation

This small observational benchmark does not diagnose disease, establish
clinical utility, or validate deployment in the proposed mobile application.
"""


def package_results(
    output_dir: Path,
    shareable_dir: Path,
    data_dir: Path,
    included_specs: list[dict[str, Any]],
    frame: pd.DataFrame,
    split_manifest: pd.DataFrame,
    feature_names: list[str],
    metrics: dict[str, Any],
    dropped: list[str],
    seed: int,
    target_counts: dict[str, int],
) -> Path:
    included_files = [spec["file"] for spec in included_specs]
    (shareable_dir / "BENCHMARK_TASK_V0.1.md").write_text(
        task_spec(included_files, seed), encoding="utf-8"
    )
    write_json(shareable_dir / "baseline_metrics.json", metrics)

    split_summary: dict[str, Any] = {}
    for split_name, group in frame.groupby("split", sort=True):
        split_summary[str(split_name)] = {
            "participants": int(group["participant_key"].nunique()),
            "examples": int(len(group)),
            "class_counts": {
                label: int((group["target_phase"] == label).sum()) for label in CLASSES
            },
        }
    manifest = {
        "benchmark_version": VERSION,
        "source_dataset": "mcPHASES v1.0.0",
        "source_doi": "10.13026/zx6a-2c81",
        "source_access": "restricted",
        "task": "current-day four-class phase prediction from prior passive summaries",
        "lookback_days": LOOKBACK_DAYS,
        "minimum_observed_lookback_days": MIN_OBSERVED_DAYS,
        "seed": seed,
        "target_source_counts_before_eligibility": target_counts,
        "included_files": [
            {
                "file": name,
                "sha256": sha256_file(data_dir / name),
                "size_bytes": (data_dir / name).stat().st_size,
            }
            for name in [TARGET_FILE] + included_files
        ],
        "examples_after_eligibility": int(len(frame)),
        "participants_after_eligibility": int(frame["participant_key"].nunique()),
        "split_summary": split_summary,
        "model_feature_count": len(feature_names),
        "dropped_all_missing_training_features": dropped,
        "private_outputs_not_in_results_zip": [
            "participant-day feature table",
            "participant split manifest",
            "row-level predictions",
            "serialized models",
        ],
    }
    write_json(shareable_dir / "benchmark_manifest.json", manifest)

    feature_rows = []
    for name in feature_names:
        if name == "lookback_observed_days":
            source = "all included modalities"
            statistic = "distinct observed lookback days"
        else:
            source = name.split("__", 1)[0]
            statistic = name.split("__", 1)[1] if "__" in name else "value"
        feature_rows.append(
            {
                "feature": name,
                "source_daily_feature": source,
                "lookback_statistic": statistic,
            }
        )
    pd.DataFrame(feature_rows).to_csv(
        shareable_dir / "feature_dictionary.csv", index=False
    )

    readme = f"""# mcPHASES Benchmark v{VERSION} baseline results

This directory contains aggregate benchmark documentation and results only.
It does not contain participant-day examples, split identities, predictions,
models, or raw restricted data.

Primary metric: validation/test macro-F1. See `baseline_metrics.json`.
The source remains governed by the PhysioNet restricted-data terms.
"""
    (shareable_dir / "README.md").write_text(readme, encoding="utf-8")

    run_metadata = {
        "generated_at": datetime.now(UTC).isoformat(),
        "python": platform.python_version(),
        "duckdb": duckdb.__version__,
        "pandas": pd.__version__,
        "scikit_learn": sklearn.__version__,
        "seed": seed,
    }
    write_json(shareable_dir / "run_metadata.json", run_metadata)

    archive_path = output_dir / "mcphases_benchmark_v01_results.zip"
    if archive_path.exists():
        archive_path.unlink()
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(shareable_dir.iterdir()):
            if path.is_file():
                archive.write(path, arcname=path.name)
    return archive_path


def main() -> int:
    args = parse_args()
    data_dir, output_dir, temp_dir = validate_paths(args)
    private_dir = output_dir / "private"
    shareable_dir = output_dir / "shareable"
    private_dir.mkdir(parents=True, exist_ok=True)
    shareable_dir.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect(str(temp_dir / "benchmark_v01.duckdb"))
    con.execute(f"SET threads = {int(args.threads)}")
    con.execute(f"SET memory_limit = {qstr(args.memory_limit)}")
    con.execute(f"SET temp_directory = {qstr(temp_dir / 'spill')}")

    target_counts = create_targets(con, data_dir / TARGET_FILE)
    daily_tables, daily_features, included_specs = create_daily_tables(
        con, data_dir, args.allow_missing_modalities
    )
    combine_daily_tables(con, daily_tables, daily_features)
    frame = build_examples(con, daily_features)
    con.close()

    frame, split_manifest = assign_splits(frame, args.seed)
    try:
        frame.to_parquet(private_dir / "benchmark_examples.parquet", index=False)
    except ImportError:
        # Colab command installs pyarrow, but retain a safe local fallback.
        frame.to_csv(private_dir / "benchmark_examples.csv", index=False)
    split_manifest.to_csv(private_dir / "split_manifest.csv", index=False)

    metrics, _, model_features, dropped = train_models(frame, private_dir, args.seed)
    archive = package_results(
        output_dir=output_dir,
        shareable_dir=shareable_dir,
        data_dir=data_dir,
        included_specs=included_specs,
        frame=frame,
        split_manifest=split_manifest,
        feature_names=model_features,
        metrics=metrics,
        dropped=dropped,
        seed=args.seed,
        target_counts=target_counts,
    )

    validation_scores = {
        name: result["validation"]["macro_f1"] for name, result in metrics.items()
    }
    selected = max(validation_scores, key=validation_scores.get)
    print()
    print("BENCHMARK BUILD COMPLETE")
    print(f"Examples: {len(frame)}")
    print(f"Participants: {frame['participant_key'].nunique()}")
    print(f"Model features: {len(model_features)}")
    print(f"Selected on validation macro-F1: {selected}")
    print(f"Test macro-F1: {metrics[selected]['test']['macro_f1']:.4f}")
    print(f"Shareable aggregate bundle: {archive}")
    print(f"Private artifacts: {private_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
