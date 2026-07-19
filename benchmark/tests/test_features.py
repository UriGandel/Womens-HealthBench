from healthbench_benchmark.features import FEATURE_COLUMNS, build_features
from healthbench_benchmark.synthetic import generate_synthetic_records


def test_every_feature_row_predates_target() -> None:
    frame = build_features(generate_synthetic_records(participants=4, days=20, seed=7))
    assert (frame["feature_day"] < frame["target_day"]).all()
    assert not {"target", "target_burden", "target_day"} & set(FEATURE_COLUMNS)


def test_target_uses_next_day_burden() -> None:
    frame = build_features(generate_synthetic_records(participants=2, days=14, seed=8))
    assert (frame["target"] == (frame["target_burden"] >= 0.5).astype(int)).all()


def test_synthetic_generation_is_deterministic() -> None:
    assert generate_synthetic_records(2, 14, 10) == generate_synthetic_records(2, 14, 10)
