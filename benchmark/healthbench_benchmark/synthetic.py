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
        hrv_method = "sdnn" if participant_index % 2 == 0 else "rmssd"
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
            has_wearable = bool(rng.random() >= 0.12)
            wearable_sleep_minutes = int(
                np.clip(round(sleep_hours * 60 + rng.normal(0, 22)), 120, 720)
            )
            steps = int(
                np.clip(
                    rng.normal(7800 - 2200 * prior_burden + 45 * activity_minutes, 1800),
                    0,
                    30000,
                )
            )
            active_energy_kcal = float(
                np.clip(rng.normal(310 + 6.4 * activity_minutes, 85), 0, 1800)
            )
            resting_heart_rate_bpm = float(
                np.clip(rng.normal(61 + 9 * prior_burden, 4.5), 40, 120)
            )
            hrv_ms = float(np.clip(rng.normal(48 - 17 * prior_burden, 8), 8, 140))
            respiratory_rate_bpm = float(
                np.clip(rng.normal(14.5 + 1.8 * prior_burden, 1.1), 8, 30)
            )
            oxygen_saturation_pct = float(
                np.clip(rng.normal(97.3 - 0.7 * prior_burden, 0.7), 90, 100)
            )
            peripheral_temperature_delta_c = float(
                np.clip(rng.normal(0.25 * prior_burden, 0.22), -2, 2)
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
                "schema_version": "2.0.0",
                "participant_id": participant_id,
                "day_in_study": day,
                "has_self_report": True,
                "has_wearable": has_wearable,
                "period_status": period_status,
                "cycle_day": cycle_day if rng.random() >= 0.06 else None,
                "sleep_hours": round(sleep_hours, 2),
                "sleep_quality": sleep_quality,
                "stress": stress,
                **symptom_values,
                "wearable_sleep_minutes": (
                    wearable_sleep_minutes
                    if has_wearable and rng.random() >= 0.04
                    else None
                ),
                "steps": steps if has_wearable and rng.random() >= 0.05 else None,
                "activity_minutes": (
                    activity_minutes if has_wearable and rng.random() >= 0.08 else None
                ),
                "active_energy_kcal": (
                    round(active_energy_kcal, 2)
                    if has_wearable and rng.random() >= 0.08
                    else None
                ),
                "resting_heart_rate_bpm": (
                    round(resting_heart_rate_bpm, 2)
                    if has_wearable and rng.random() >= 0.1
                    else None
                ),
                "hrv_ms": (
                    round(hrv_ms, 2)
                    if has_wearable and rng.random() >= 0.18
                    else None
                ),
                "hrv_method": hrv_method,
                "respiratory_rate_bpm": (
                    round(respiratory_rate_bpm, 2)
                    if has_wearable and rng.random() >= 0.2
                    else None
                ),
                "oxygen_saturation_pct": (
                    round(oxygen_saturation_pct, 2)
                    if has_wearable and rng.random() >= 0.3
                    else None
                ),
                "peripheral_temperature_delta_c": (
                    round(peripheral_temperature_delta_c, 3)
                    if has_wearable and day >= 3 and rng.random() >= 0.22
                    else None
                ),
                "source": "synthetic",
            }
            if record["hrv_ms"] is None:
                record["hrv_method"] = None
            records.append(record)

    # Guard against accidental NaN values, which are not valid JSON.
    assert all(
        not isinstance(value, float) or math.isfinite(value)
        for record in records
        for value in record.values()
    )
    return records
