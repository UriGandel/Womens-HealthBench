import math

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


def test_wearable_only_day_can_predict_next_day_self_report() -> None:
    records = generate_synthetic_records(2, 14, 12)
    participant = records[0]["participant_id"]
    records[1].update(
        {
            "has_self_report": False,
            "period_status": None,
            "cycle_day": None,
            "sleep_hours": None,
            "sleep_quality": None,
            "stress": None,
            "fatigue": None,
            "brain_fog": None,
            "headache": None,
            "pelvic_pain": None,
            "mood_disruption": None,
        }
    )
    frame = build_features(records)
    wearable_only = frame[
        (frame["participant_id"] == participant) & (frame["feature_day"] == 1)
    ].iloc[0]
    assert math.isnan(wearable_only["current_burden"])
    assert wearable_only["target_day"] == 2
    assert wearable_only["steps"] is not None


def test_hrv_methods_are_never_combined_and_temperature_baseline_is_causal() -> None:
    records = generate_synthetic_records(2, 14, 13)
    participant = records[0]["participant_id"]
    method = records[0]["hrv_method"]
    frame = build_features(records)
    rows = frame[frame["participant_id"] == participant]
    if method == "sdnn":
        assert rows["hrv_rmssd_z"].isna().all()
    else:
        assert rows["hrv_sdnn_z"].isna().all()
    first_three = rows[rows["feature_day"] < 3]
    assert first_three["peripheral_temperature_delta_c"].isna().all()
