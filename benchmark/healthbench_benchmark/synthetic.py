"""Deterministic synthetic data for demos and continuous integration.

These records are generated from a simulation. They are not patient records and
must not be interpreted as evidence of a clinical relationship.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

SYMPTOMS = ("fatigue", "brain_fog", "headache", "pelvic_pain", "mood_disruption")


def _rating(value: float) -> int:
    return int(np.clip(round(value), 0, 4))


def generate_synthetic_records(
    participants: int = 42,
    days: int = 84,
    seed: int = 20260719,
) -> list[dict[str, Any]]:
    """Generate stable longitudinal records containing no direct identifiers."""
    if participants < 2:
        raise ValueError("participants must be at least 2")
    if days < 14:
        raise ValueError("days must be at least 14")

    rng = np.random.default_rng(seed)
    records: list[dict[str, Any]] = []
    for participant_index in range(participants):
        participant_id = f"synthetic-{participant_index + 1:03d}"
        cycle_length = int(rng.integers(24, 36))
        cycle_offset = int(rng.integers(0, cycle_length))
        baseline = float(rng.normal(0.15, 0.35))
        sensitivity = float(rng.uniform(0.65, 1.3))
        prior_burden = float(rng.uniform(0.1, 0.6))

        for day in range(days):
            cycle_day = ((day + cycle_offset) % cycle_length) + 1
            period_status = "flow" if cycle_day <= 5 else "none"
            if cycle_day == cycle_length:
                period_status = "spotting"

            sleep_hours = float(np.clip(rng.normal(7.2 - 0.35 * prior_burden, 1.0), 3, 11))
            sleep_quality = _rating((sleep_hours - 4.5) / 1.25 + rng.normal(0, 0.55))
            stress = _rating(rng.normal(1.65 + 0.55 * prior_burden, 0.9))
            activity_minutes = int(
                np.clip(rng.normal(42 - 9 * prior_burden + 4 * sleep_quality, 19), 0, 180)
            )
            cycle_pressure = (
                0.8 if cycle_day <= 3 else 0.45 if cycle_day >= cycle_length - 2 else 0
            )
            latent = (
                baseline
                + sensitivity
                * (
                    0.34 * prior_burden
                    + 0.20 * stress
                    + 0.18 * (4 - sleep_quality)
                    + cycle_pressure
                    - 0.004 * activity_minutes
                )
                + rng.normal(0, 0.48)
            )
            symptom_values = {
                symptom: _rating(
                    latent
                    + rng.normal(0, 0.55)
                    + (0.45 if symptom == "pelvic_pain" and cycle_day <= 4 else 0)
                )
                for symptom in SYMPTOMS
            }
            prior_burden = sum(symptom_values.values()) / (4 * len(SYMPTOMS))

            # Ancillary missingness is deterministic under the seed. Outcome symptoms stay
            # complete so the benchmark target has a single documented interpretation.
            record: dict[str, Any] = {
                "schema_version": "1.0.0",
                "participant_id": participant_id,
                "day_in_study": day,
                "period_status": period_status,
                "cycle_day": cycle_day if rng.random() >= 0.06 else None,
                "sleep_hours": round(sleep_hours, 2) if rng.random() >= 0.04 else None,
                "sleep_quality": sleep_quality if rng.random() >= 0.04 else None,
                "stress": stress,
                "activity_minutes": activity_minutes if rng.random() >= 0.08 else None,
                **symptom_values,
                "source": "synthetic",
            }
            records.append(record)

    # Guard against accidental NaN values, which are not valid JSON.
    assert all(
        not isinstance(value, float) or math.isfinite(value)
        for record in records
        for value in record.values()
    )
    return records
