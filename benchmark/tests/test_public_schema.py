import json
from copy import deepcopy
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def test_synthetic_examples_match_public_research_schema() -> None:
    schema = json.loads(
        (REPOSITORY_ROOT / "schemas" / "research-checkin.schema.json").read_text()
    )
    records = json.loads(
        (REPOSITORY_ROOT / "schemas" / "synthetic-example-records.json").read_text()
    )

    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    for record in records:
        validator.validate(record)


def test_schema_rejects_empty_or_partial_self_report_records() -> None:
    schema = json.loads(
        (REPOSITORY_ROOT / "schemas" / "research-checkin.schema.json").read_text()
    )
    records = json.loads(
        (REPOSITORY_ROOT / "schemas" / "synthetic-example-records.json").read_text()
    )
    validator = Draft202012Validator(schema)

    empty = deepcopy(records[1])
    empty["has_wearable"] = False
    for field in (
        "wearable_sleep_minutes",
        "steps",
        "activity_minutes",
        "active_energy_kcal",
        "resting_heart_rate_bpm",
        "hrv_ms",
        "hrv_method",
        "respiratory_rate_bpm",
        "oxygen_saturation_pct",
        "peripheral_temperature_delta_c",
    ):
        empty[field] = None
    with pytest.raises(ValidationError):
        validator.validate(empty)

    partial = deepcopy(records[0])
    partial["fatigue"] = None
    with pytest.raises(ValidationError):
        validator.validate(partial)


def test_intraday_schema_accepts_only_pseudonymous_bucket_aggregates() -> None:
    schema = json.loads(
        (
            REPOSITORY_ROOT
            / "schemas"
            / "research-wearable-interval.schema.json"
        ).read_text()
    )
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    record = {
        "schema_version": "1.0.0",
        "participant_id": "participant_001",
        "day_in_study": 12,
        "bucket_index": 2,
        "steps": 1800,
        "activity_minutes": 20,
        "active_energy_kcal": 154.2,
        "heart_rate_avg_bpm": 73.0,
        "heart_rate_min_bpm": 52.0,
        "heart_rate_max_bpm": 139.0,
        "heart_rate_sample_count": 44,
        "hrv_avg_ms": 38.2,
        "hrv_sample_count": 3,
        "hrv_method": "sdnn",
        "respiratory_rate_avg_bpm": 15.1,
        "respiratory_rate_sample_count": 4,
        "oxygen_saturation_avg_pct": 97.3,
        "oxygen_saturation_sample_count": 5,
        "source": "private-alpha",
    }
    validator.validate(record)

    with_date = {**record, "observed_date": "2026-07-19"}
    with pytest.raises(ValidationError):
        validator.validate(with_date)
