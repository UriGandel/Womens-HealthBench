"""Restricted-source loading policy."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_records(path: Path, *, source: str) -> list[dict[str, Any]]:
    """Load local normalized records without ever exporting source records."""
    if source not in {"synthetic", "mcphases-local"}:
        raise ValueError("source must be 'synthetic' or 'mcphases-local'")
    if source == "mcphases-local" and path.name.lower().endswith((".zip", ".tar", ".gz")):
        raise ValueError(
            "Raw mcPHASES archives are unsupported. Normalize restricted data locally "
            "to the public schema and keep it outside this repository."
        )
    if path.resolve().is_relative_to(Path.cwd().resolve()) and source == "mcphases-local":
        raise ValueError("Restricted mcPHASES records must remain outside the repository")
    records = json.loads(path.read_text())
    if not isinstance(records, list):
        raise ValueError("input must be a JSON array of normalized records")
    return records
