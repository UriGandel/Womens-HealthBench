import argparse
import csv
import hmac
import os
from pathlib import Path

from sqlalchemy import select

from app.database import SessionLocal
from app.models import ResearchEvent, ResearchWearableDay

EXPORT_FIELDS = (
    "schema_version",
    "participant_id",
    "day_in_study",
    "has_self_report",
    "has_wearable",
    "period_status",
    "cycle_day",
    "sleep_hours",
    "sleep_quality",
    "stress",
    "fatigue",
    "brain_fog",
    "headache",
    "pelvic_pain",
    "mood_disruption",
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
    "source",
)


def export_record(row: ResearchEvent) -> dict[str, object]:
    """Return the deliberately narrow, pseudonymous export representation."""
    return {
        "schema_version": "2.0.0",
        "participant_id": row.research_id,
        "day_in_study": row.day_in_study,
        "has_self_report": True,
        "has_wearable": False,
        "period_status": row.period_status,
        "cycle_day": row.cycle_day,
        "sleep_hours": row.sleep_hours,
        "sleep_quality": row.sleep_quality,
        "stress": row.stress,
        "fatigue": row.fatigue,
        "brain_fog": row.brain_fog,
        "headache": row.headache,
        "pelvic_pain": row.pelvic_pain,
        "mood_disruption": row.mood_disruption,
        "wearable_sleep_minutes": None,
        "steps": None,
        "activity_minutes": None,
        "active_energy_kcal": None,
        "resting_heart_rate_bpm": None,
        "hrv_ms": None,
        "hrv_method": None,
        "respiratory_rate_bpm": None,
        "oxygen_saturation_pct": None,
        "peripheral_temperature_delta_c": None,
        "source": "private-alpha",
    }


def wearable_export_record(row: ResearchWearableDay) -> dict[str, object]:
    return {
        "schema_version": "2.0.0",
        "participant_id": row.research_id,
        "day_in_study": row.day_in_study,
        "has_self_report": False,
        "has_wearable": True,
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
        "wearable_sleep_minutes": row.sleep_minutes,
        "steps": row.steps,
        "activity_minutes": row.activity_minutes,
        "active_energy_kcal": row.active_energy_kcal,
        "resting_heart_rate_bpm": row.resting_heart_rate_bpm,
        "hrv_ms": row.hrv_ms,
        "hrv_method": row.hrv_method,
        "respiratory_rate_bpm": row.respiratory_rate_bpm,
        "oxygen_saturation_pct": row.oxygen_saturation_pct,
        "peripheral_temperature_delta_c": row.peripheral_temperature_delta_c,
        "source": "private-alpha",
    }


def export_records(
    checkin_rows: list[ResearchEvent],
    wearable_rows: list[ResearchWearableDay],
) -> list[dict[str, object]]:
    """Merge purpose-limited research sources into participant-day observations."""
    merged: dict[tuple[str, int], dict[str, object]] = {}
    for row in checkin_rows:
        key = (row.research_id, row.day_in_study)
        merged[key] = export_record(row)
    for row in wearable_rows:
        key = (row.research_id, row.day_in_study)
        wearable = wearable_export_record(row)
        if key not in merged:
            merged[key] = wearable
            continue
        combined = merged[key]
        combined["has_wearable"] = True
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
            combined[field] = wearable[field]
    return [merged[key] for key in sorted(merged)]


def main() -> None:
    parser = argparse.ArgumentParser(description="Export private pseudonymous research rows")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--key", required=True)
    parser.add_argument("--acknowledge-private", action="store_true")
    args = parser.parse_args()

    expected = os.environ.get("ADMIN_EXPORT_KEY")
    if not args.acknowledge_private:
        raise SystemExit("Refusing export without --acknowledge-private")
    if not expected or not hmac.compare_digest(args.key, expected):
        raise SystemExit("Invalid administrator export key")

    with SessionLocal() as session:
        checkin_rows = session.scalars(
            select(ResearchEvent).order_by(
                ResearchEvent.research_id, ResearchEvent.day_in_study
            )
        ).all()
        wearable_rows = session.scalars(
            select(ResearchWearableDay).order_by(
                ResearchWearableDay.research_id,
                ResearchWearableDay.day_in_study,
            )
        ).all()
        rows = export_records(list(checkin_rows), list(wearable_rows))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=EXPORT_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Exported {len(rows)} private rows to {args.output}")


if __name__ == "__main__":
    main()
