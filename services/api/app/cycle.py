from datetime import date, timedelta
from math import ceil
from statistics import mean, median

from app.models import CheckIn, CycleDay
from app.schemas import (
    CycleDayRecord,
    CyclePattern,
    CyclePhaseDay,
    CycleTrackingSummary,
    PredictedPeriodWindow,
)

SYMPTOMS = (
    ("Fatigue", "fatigue"),
    ("Brain fog", "brain_fog"),
    ("Headache", "headache"),
    ("Pelvic pain", "pelvic_pain"),
    ("Mood disruption", "mood_disruption"),
)
MIN_PREDICTABLE_CYCLE_DAYS = 15
MAX_PREDICTABLE_CYCLE_DAYS = 90
MAX_INTERVAL_SPREAD_DAYS = 14
MAX_PROJECTION_DAYS = 90


def merged_bleeding_days(
    days: list[CycleDay],
    checkins: list[CheckIn],
) -> list[CycleDayRecord]:
    """Merge check-in observations with editable history.

    A separate cycle-history value is the operational correction for its date.
    Completed check-ins remain untouched and retain their original research value.
    """
    merged: dict[date, str] = {
        checkin.observed_date: checkin.period_status
        for checkin in checkins
        if checkin.period_status in {"spotting", "flow"}
    }
    for day in days:
        if day.period_status == "none":
            merged.pop(day.observed_date, None)
        else:
            merged[day.observed_date] = day.period_status
    return [
        CycleDayRecord(observed_date=observed_date, period_status=period_status)
        for observed_date, period_status in sorted(merged.items())
    ]


def cycle_starts(days: list[CycleDayRecord]) -> list[date]:
    flow_dates = {day.observed_date for day in days if day.period_status == "flow"}
    return sorted(
        observed_date
        for observed_date in flow_dates
        if observed_date - timedelta(days=1) not in flow_dates
    )


def _flow_lengths(days: list[CycleDayRecord], starts: list[date]) -> list[int]:
    flow_dates = {day.observed_date for day in days if day.period_status == "flow"}
    lengths: list[int] = []
    for start in starts:
        length = 0
        cursor = start
        while cursor in flow_dates:
            length += 1
            cursor += timedelta(days=1)
        if length:
            lengths.append(length)
    return lengths


def _phase_for_date(
    value: date,
    *,
    cycle_start: date,
    next_start: date,
    flow_length: int,
) -> str:
    if value < cycle_start + timedelta(days=flow_length):
        return "menstrual"
    estimated_ovulation = next_start - timedelta(days=14)
    if value < estimated_ovulation - timedelta(days=3):
        return "follicular"
    if value <= estimated_ovulation + timedelta(days=3):
        return "ovulatory"
    return "luteal"


def _projection(
    *,
    merged_days: list[CycleDayRecord],
    starts: list[date],
    today: date,
) -> tuple[
    str,
    str | None,
    float | None,
    date | None,
    list[CyclePhaseDay],
    list[PredictedPeriodWindow],
]:
    if len(starts) < 3:
        return "insufficient_data", None, None, None, [], []

    intervals = [
        (later - earlier).days
        for earlier, later in zip(starts, starts[1:], strict=False)
    ]
    if any(
        interval < MIN_PREDICTABLE_CYCLE_DAYS
        or interval > MAX_PREDICTABLE_CYCLE_DAYS
        for interval in intervals
    ):
        return "variable", None, None, None, [], []
    spread = max(intervals) - min(intervals)
    if spread > MAX_INTERVAL_SPREAD_DAYS:
        return "variable", None, float(median(intervals)), None, [], []

    cycle_length = max(1, round(median(intervals)))
    observed_flow_lengths = _flow_lengths(merged_days, starts)
    flow_length = max(1, min(14, round(median(observed_flow_lengths or [5]))))
    confidence = (
        "high"
        if len(intervals) >= 4 and spread <= 3
        else "medium"
        if spread <= 7
        else "low"
    )
    horizon = min(
        today + timedelta(days=MAX_PROJECTION_DAYS),
        starts[-1] + timedelta(days=2 * cycle_length),
    )
    projected_starts = [
        starts[-1] + timedelta(days=cycle_length),
        starts[-1] + timedelta(days=2 * cycle_length),
    ]
    uncertainty = min(7, max(2, ceil(spread / 2)))
    windows = [
        PredictedPeriodWindow(
            start_date=projected_start - timedelta(days=uncertainty),
            end_date=projected_start + timedelta(days=uncertainty),
            confidence="medium" if index == 0 and confidence != "low" else "low",
        )
        for index, projected_start in enumerate(projected_starts)
        if projected_start - timedelta(days=uncertainty) <= horizon
    ]

    boundaries = [starts[-1], *projected_starts]
    phase_days: list[CyclePhaseDay] = []
    cursor = starts[-1]
    while cursor <= horizon:
        cycle_index = min(
            index
            for index in range(len(boundaries) - 1)
            if cursor < boundaries[index + 1]
        ) if cursor < boundaries[-1] else len(boundaries) - 2
        phase_days.append(
            CyclePhaseDay(
                observed_date=cursor,
                phase=_phase_for_date(
                    cursor,
                    cycle_start=boundaries[cycle_index],
                    next_start=boundaries[cycle_index + 1],
                    flow_length=flow_length,
                ),
                predicted=cursor > today,
                confidence=(
                    confidence
                    if cursor <= projected_starts[0]
                    else "low"
                ),
            )
        )
        cursor += timedelta(days=1)
    return (
        "ready",
        confidence,
        float(cycle_length),
        horizon,
        phase_days,
        windows,
    )


def build_cycle_summary(
    *,
    enabled: bool,
    days: list[CycleDay],
    checkins: list[CheckIn],
    today: date,
) -> CycleTrackingSummary:
    ordered_days = merged_bleeding_days(days, checkins)
    starts = cycle_starts(ordered_days)
    latest_start = starts[-1] if starts else None
    current_cycle_day = None
    if latest_start is not None:
        candidate = (today - latest_start).days + 1
        if 1 <= candidate <= 120:
            current_cycle_day = candidate

    (
        prediction_status,
        prediction_confidence,
        observed_length,
        projected_through,
        phase_days,
        predicted_period_windows,
    ) = _projection(merged_days=ordered_days, starts=starts, today=today)

    bleeding_dates = {day.observed_date for day in ordered_days}
    bleeding_checkins = [
        checkin for checkin in checkins if checkin.observed_date in bleeding_dates
    ]
    non_bleeding_checkins = [
        checkin for checkin in checkins if checkin.observed_date not in bleeding_dates
    ]

    patterns: list[tuple[float, CyclePattern]] = []
    if len(starts) >= 3 and len(bleeding_checkins) >= 3 and len(non_bleeding_checkins) >= 3:
        for label, field in SYMPTOMS:
            difference = mean(
                getattr(checkin, field) for checkin in bleeding_checkins
            ) - mean(getattr(checkin, field) for checkin in non_bleeding_checkins)
            if abs(difference) < 0.5:
                continue
            direction = "higher" if difference > 0 else "lower"
            patterns.append(
                (
                    abs(difference),
                    CyclePattern(
                        label=label,
                        direction=direction,
                        detail=(
                            f"{label} averaged {abs(difference):.1f} points {direction} "
                            "on logged bleeding days in your records."
                        ),
                    ),
                )
            )
    patterns.sort(key=lambda item: (-item[0], item[1].label))
    pattern_ready = (
        len(starts) >= 3
        and len(bleeding_checkins) >= 3
        and len(non_bleeding_checkins) >= 3
    )
    return CycleTrackingSummary(
        enabled=enabled,
        days=ordered_days,
        current_cycle_day=current_cycle_day,
        cycle_started_on=latest_start,
        observed_cycle_length_days=observed_length,
        cycle_start_count=len(starts),
        pattern_status="ready" if pattern_ready else "insufficient_data",
        patterns=[item[1] for item in patterns[:3]],
        prediction_status=prediction_status,
        prediction_confidence=prediction_confidence,
        projected_through=projected_through,
        phase_days=phase_days,
        predicted_period_windows=predicted_period_windows,
    )
