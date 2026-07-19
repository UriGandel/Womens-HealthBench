from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import (
    Account,
    CheckIn,
    ConsentRecord,
    ResearchEvent,
    ResearchWearableDay,
    ResearchWearableInterval,
    WearableDailySummary,
    WearableIntervalSummary,
)


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


def to_research_wearable_day(
    account: Account,
    wearable_day: WearableDailySummary,
) -> ResearchWearableDay:
    link = account.participant_link
    return ResearchWearableDay(
        research_id=link.research_id,
        source_wearable_day_id=wearable_day.id,
        day_in_study=(wearable_day.observed_date - link.day_zero).days,
        sleep_minutes=wearable_day.sleep_minutes,
        steps=wearable_day.steps,
        activity_minutes=wearable_day.activity_minutes,
        active_energy_kcal=wearable_day.active_energy_kcal,
        resting_heart_rate_bpm=wearable_day.resting_heart_rate_bpm,
        hrv_ms=wearable_day.hrv_ms,
        hrv_method=wearable_day.hrv_method,
        respiratory_rate_bpm=wearable_day.respiratory_rate_bpm,
        oxygen_saturation_pct=wearable_day.oxygen_saturation_pct,
        peripheral_temperature_delta_c=wearable_day.peripheral_temperature_delta_c,
    )


def to_research_wearable_interval(
    account: Account,
    interval: WearableIntervalSummary,
) -> ResearchWearableInterval:
    link = account.participant_link
    return ResearchWearableInterval(
        research_id=link.research_id,
        source_wearable_interval_id=interval.id,
        day_in_study=(interval.observed_date - link.day_zero).days,
        bucket_index=interval.bucket_start_hour // 6,
        steps=interval.steps,
        activity_minutes=interval.activity_minutes,
        active_energy_kcal=interval.active_energy_kcal,
        heart_rate_avg_bpm=interval.heart_rate_avg_bpm,
        heart_rate_min_bpm=interval.heart_rate_min_bpm,
        heart_rate_max_bpm=interval.heart_rate_max_bpm,
        heart_rate_sample_count=interval.heart_rate_sample_count,
        hrv_avg_ms=interval.hrv_avg_ms,
        hrv_sample_count=interval.hrv_sample_count,
        hrv_method=interval.hrv_method,
        respiratory_rate_avg_bpm=interval.respiratory_rate_avg_bpm,
        respiratory_rate_sample_count=interval.respiratory_rate_sample_count,
        oxygen_saturation_avg_pct=interval.oxygen_saturation_avg_pct,
        oxygen_saturation_sample_count=interval.oxygen_saturation_sample_count,
    )


def rebuild_research_timeline(session: Session, account: Account) -> int:
    """Rebuild the pseudonymous union of all consent-covered participant days."""
    checkins = session.scalars(
        select(CheckIn)
        .where(CheckIn.account_id == account.id)
        .order_by(CheckIn.observed_date, CheckIn.id)
    ).all()
    wearable_days = session.scalars(
        select(WearableDailySummary)
        .where(WearableDailySummary.account_id == account.id)
        .order_by(WearableDailySummary.observed_date, WearableDailySummary.id)
    ).all()
    wearable_intervals = session.scalars(
        select(WearableIntervalSummary)
        .where(WearableIntervalSummary.account_id == account.id)
        .order_by(
            WearableIntervalSummary.observed_date,
            WearableIntervalSummary.bucket_start_hour,
            WearableIntervalSummary.id,
        )
    ).all()
    clear_research_rows(session, account)
    session.flush()
    observed_dates = [
        *(checkin.observed_date for checkin in checkins),
        *(wearable.observed_date for wearable in wearable_days),
        *(interval.observed_date for interval in wearable_intervals),
    ]
    if not observed_dates:
        return 0

    account.participant_link.day_zero = min(observed_dates)
    for checkin in checkins:
        session.add(to_research_event(account, checkin))
    for wearable_day in wearable_days:
        session.add(to_research_wearable_day(account, wearable_day))
    for interval in wearable_intervals:
        session.add(to_research_wearable_interval(account, interval))
    return len(set(observed_dates))


def rebuild_contributed_checkins(
    session: Session,
    account: Account,
    *,
    added_checkin: CheckIn | None = None,
) -> int:
    """Compatibility wrapper for the existing check-in ingestion path."""
    del added_checkin
    return rebuild_research_timeline(session, account)


def clear_research_rows(session: Session, account: Account) -> None:
    session.execute(
        delete(ResearchEvent).where(
            ResearchEvent.research_id == account.participant_link.research_id
        )
    )
    session.execute(
        delete(ResearchWearableDay).where(
            ResearchWearableDay.research_id == account.participant_link.research_id
        )
    )
    session.execute(
        delete(ResearchWearableInterval).where(
            ResearchWearableInterval.research_id
            == account.participant_link.research_id
        )
    )


def research_record_count(session: Session, account: Account) -> int:
    research_id = account.participant_link.research_id
    checkin_days = set(
        session.scalars(
            select(ResearchEvent.day_in_study).where(ResearchEvent.research_id == research_id)
        ).all()
    )
    wearable_days = set(
        session.scalars(
            select(ResearchWearableDay.day_in_study).where(
                ResearchWearableDay.research_id == research_id
            )
        ).all()
    )
    interval_days = set(
        session.scalars(
            select(ResearchWearableInterval.day_in_study).where(
                ResearchWearableInterval.research_id == research_id
            )
        ).all()
    )
    return len(checkin_days | wearable_days | interval_days)


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
