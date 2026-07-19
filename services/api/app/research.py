from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import Account, CheckIn, ConsentRecord, ResearchEvent


def current_consent(session: Session, account_id: str) -> ConsentRecord:
    consent = session.scalar(
        select(ConsentRecord)
        .where(ConsentRecord.account_id == account_id)
        .order_by(ConsentRecord.created_at.desc(), ConsentRecord.id.desc())
        .limit(1)
    )
    if consent is None:
        raise RuntimeError("Account has no consent record")
    return consent


def to_research_event(account: Account, checkin: CheckIn) -> ResearchEvent:
    link = account.participant_link
    return ResearchEvent(
        research_id=link.research_id,
        source_checkin_id=checkin.id,
        day_in_study=(checkin.observed_date - link.day_zero).days,
        period_status=checkin.period_status,
        cycle_day=checkin.cycle_day,
        sleep_hours=checkin.sleep_hours,
        sleep_quality=checkin.sleep_quality,
        stress=checkin.stress,
        fatigue=checkin.fatigue,
        brain_fog=checkin.brain_fog,
        headache=checkin.headache,
        pelvic_pain=checkin.pelvic_pain,
        mood_disruption=checkin.mood_disruption,
    )


def rebuild_contributed_checkins(
    session: Session,
    account: Account,
    *,
    added_checkin: CheckIn | None = None,
    include_existing: bool = False,
) -> int:
    """Rebase only consent-covered records onto a zero-based study timeline."""
    source_ids = set(
        session.scalars(
            select(ResearchEvent.source_checkin_id).where(
                ResearchEvent.research_id == account.participant_link.research_id
            )
        ).all()
    )
    if added_checkin is not None:
        source_ids.add(added_checkin.id)

    query = select(CheckIn).where(
        CheckIn.account_id == account.id,
        CheckIn.is_synthetic.is_(False),
    )
    if not include_existing:
        if not source_ids:
            return 0
        query = query.where(CheckIn.id.in_(source_ids))
    checkins = session.scalars(query.order_by(CheckIn.observed_date, CheckIn.id)).all()

    withdraw_research_rows(session, account)
    session.flush()
    if not checkins:
        return 0

    account.participant_link.day_zero = checkins[0].observed_date
    for checkin in checkins:
        session.add(to_research_event(account, checkin))
    return len(checkins)


def contribute_existing_checkins(session: Session, account: Account) -> int:
    return rebuild_contributed_checkins(session, account, include_existing=True)


def withdraw_research_rows(session: Session, account: Account) -> None:
    session.execute(
        delete(ResearchEvent).where(
            ResearchEvent.research_id == account.participant_link.research_id
        )
    )


def research_record_count(session: Session, account: Account) -> int:
    return int(
        session.scalar(
            select(func.count(ResearchEvent.id)).where(
                ResearchEvent.research_id == account.participant_link.research_id
            )
        )
        or 0
    )


def is_checkin_contributed(session: Session, account: Account, checkin: CheckIn) -> bool:
    return (
        session.scalar(
            select(ResearchEvent.id).where(
                ResearchEvent.research_id == account.participant_link.research_id,
                ResearchEvent.source_checkin_id == checkin.id,
            )
        )
        is not None
    )
