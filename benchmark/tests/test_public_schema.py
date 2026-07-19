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
