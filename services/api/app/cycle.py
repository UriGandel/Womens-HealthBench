from datetime import date, timedelta
from statistics import mean, median

from app.models import CheckIn, CycleDay
from app.schemas import CycleDayRecord, CyclePattern, CycleTrackingSummary

SYMPTOMS = (
    ("Fatigue", "fatigue"),
    ("Brain fog", "brain_fog"),
    ("Headache", "headache"),
    ("Pelvic pain", "pelvic_pain"),
    ("Mood disruption", "mood_disruption"),
)


def cycle_starts(days: list[CycleDay]) -> list[date]:
    flow_dates = {day.observed_date for day in days if day.period_status == "flow"}
    return sorted(
        observed_date
        for observed_date in flow_dates
        if observed_date - timedelta(days=1) not in flow_dates
    )


def build_cycle_summary(
    *,
    enabled: bool,
    days: list[CycleDay],
    checkins: list[CheckIn],
    today: date,
) -> CycleTrackingSummary:
    if not enabled:
        return CycleTrackingSummary(enabled=False)

    ordered_days = sorted(days, key=lambda item: item.observed_date)
    starts = cycle_starts(ordered_days)
    latest_start = starts[-1] if starts else None
    current_cycle_day = None
    if latest_start is not None:
        candidate = (today - latest_start).days + 1
        if 1 <= candidate <= 120:
            current_cycle_day = candidate

    observed_length = None
    if len(starts) >= 3:
        lengths = [
            (later - earlier).days
            for earlier, later in zip(starts, starts[1:], strict=False)
        ]
        plausible_lengths = [length for length in lengths if 1 <= length <= 120]
        if len(plausible_lengths) >= 2:
            observed_length = float(median(plausible_lengths))

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
            bleeding_average = mean(getattr(checkin, field) for checkin in bleeding_checkins)
            other_average = mean(
                getattr(checkin, field) for checkin in non_bleeding_checkins
            )
            difference = bleeding_average - other_average
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
    selected_patterns = [item[1] for item in patterns[:3]]
    pattern_ready = (
        len(starts) >= 3
        and len(bleeding_checkins) >= 3
        and len(non_bleeding_checkins) >= 3
    )

    return CycleTrackingSummary(
        enabled=True,
        days=[
            CycleDayRecord(
                observed_date=day.observed_date,
                period_status=day.period_status,
            )
            for day in ordered_days
        ],
        current_cycle_day=current_cycle_day,
        cycle_started_on=latest_start,
        observed_cycle_length_days=observed_length,
        cycle_start_count=len(starts),
        pattern_status="ready" if pattern_ready else "insufficient_data",
        patterns=selected_patterns,
    )
