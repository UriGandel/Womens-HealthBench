import json
from pathlib import Path

from jsonschema import Draft202012Validator

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
