import argparse
import csv
import hmac
import os
from pathlib import Path

from sqlalchemy import select

from app.database import SessionLocal
from app.models import ResearchEvent

EXPORT_FIELDS = (
    "schema_version",
    "participant_id",
    "day_in_study",
    "period_status",
    "cycle_day",
    "sleep_hours",
    "sleep_quality",
    "stress",
    "activity_minutes",
    "fatigue",
    "brain_fog",
    "headache",
    "pelvic_pain",
    "mood_disruption",
    "source",
)


def export_record(row: ResearchEvent) -> dict[str, object]:
    """Return the deliberately narrow, pseudonymous export representation."""
    return {
        "schema_version": "1.0.0",
        "participant_id": row.research_id,
        "day_in_study": row.day_in_study,
        "period_status": row.period_status,
        "cycle_day": row.cycle_day,
        "sleep_hours": row.sleep_hours,
        "sleep_quality": row.sleep_quality,
        "stress": row.stress,
        "activity_minutes": None,
        "fatigue": row.fatigue,
        "brain_fog": row.brain_fog,
        "headache": row.headache,
        "pelvic_pain": row.pelvic_pain,
        "mood_disruption": row.mood_disruption,
        "source": "private-alpha",
    }


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
        rows = session.scalars(
            select(ResearchEvent).order_by(
                ResearchEvent.research_id, ResearchEvent.day_in_study
            )
        ).all()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=EXPORT_FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow(export_record(row))
    print(f"Exported {len(rows)} private rows to {args.output}")


if __name__ == "__main__":
    main()
