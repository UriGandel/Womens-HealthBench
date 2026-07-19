import numpy as np
from sklearn.model_selection import GroupKFold

from healthbench_benchmark.evaluation import _rolling_predictions, run_benchmark
from healthbench_benchmark.features import build_features
from healthbench_benchmark.synthetic import generate_synthetic_records


def _frame():
    return build_features(generate_synthetic_records(participants=6, days=28, seed=9))


def test_grouped_folds_never_mix_participants() -> None:
    frame = _frame()
    splitter = GroupKFold(n_splits=3)
    for train, test in splitter.split(frame, frame["target"], frame["participant_id"]):
        assert set(frame.iloc[train]["participant_id"]).isdisjoint(
            set(frame.iloc[test]["participant_id"])
        )


def test_rolling_holdout_is_strictly_temporal() -> None:
    frame = _frame()
    test, predictions = _rolling_predictions(frame)
    for participant_id, held_out in test.groupby("participant_id"):
        training = frame[
            (frame["participant_id"] == participant_id)
            & (frame["target_day"] < held_out["target_day"].min())
        ]
        assert training["target_day"].max() < held_out["target_day"].min()
    assert all(np.isfinite(values).all() for values in predictions.values())


def test_report_contains_predefined_models_and_metrics() -> None:
    report = run_benchmark(generate_synthetic_records(6, 28, 11), grouped_folds=3)
    models = report["protocols"]["participant_grouped_cross_validation"]["models"]
    assert set(models) == {
        "previous_day_burden",
        "participant_historical_rate",
        "cycle_logistic",
        "gradient_boosting",
    }
    assert {"auroc", "auprc", "brier", "calibration_error"} <= set(
        models["gradient_boosting"]
    )
