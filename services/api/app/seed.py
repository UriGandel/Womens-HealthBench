from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import hash_secret
from app.config import Settings
from app.models import CheckIn, Invitation


def ensure_demo_invitation(session: Session, settings: Settings) -> None:
    if not settings.demo_mode:
        return
    code_hash = hash_secret(settings.demo_invite_code)
    existing = session.scalar(select(Invitation).where(Invitation.code_hash == code_hash))
    if existing is None:
        session.add(
            Invitation(
                code_hash=code_hash,
                expires_at=datetime.now(UTC) + timedelta(days=365),
            )
        )
        session.commit()


def seed_demo_checkins(session: Session, account_id: str) -> None:
    today = date.today()
    patterns = [
        (7.5, 3, 1, 1, 0, 0, 1, 0),
        (7.2, 3, 1, 1, 1, 0, 1, 0),
        (6.8, 2, 2, 1, 1, 0, 1, 1),
        (6.4, 2, 2, 2, 1, 1, 1, 1),
        (6.1, 2, 3, 2, 2, 1, 2, 1),
        (5.8, 1, 3, 3, 2, 2, 2, 2),
        (5.5, 1, 4, 3, 3, 2, 3, 2),
    ]
    for index, values in enumerate(patterns):
        sleep_hours, sleep_quality, stress, fatigue, fog, headache, pain, mood = values
        # Seed the seven completed days before enrollment so the participant can
        # still submit a real check-in today.
        observed = today - timedelta(days=7 - index)
        session.add(
            CheckIn(
                account_id=account_id,
                client_submission_id=f"demo-{account_id}-{index}",
                observed_date=observed,
                period_status="flow" if index >= 5 else "none",
                cycle_day=26 + index if index < 5 else index - 4,
                sleep_hours=sleep_hours,
                sleep_quality=sleep_quality,
                stress=stress,
                fatigue=fatigue,
                brain_fog=fog,
                headache=headache,
                pelvic_pain=pain,
                mood_disruption=mood,
                is_synthetic=True,
            )
        )
