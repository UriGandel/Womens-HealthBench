import math
from collections.abc import Sequence
from statistics import mean

from app.models import CheckIn
from app.schemas import ForecastFactor, ForecastResponse

MODEL_VERSION = "tomorrow-gently-transparent-0.1.0"
DISCLAIMER = (
    "Experimental wellness forecast — not a diagnosis or medical advice. "
    "Do not delay professional care because of this result."
)


def symptom_burden(checkin: CheckIn) -> float:
    values = (
        checkin.fatigue,
        checkin.brain_fog,
        checkin.headache,
        checkin.pelvic_pain,
        checkin.mood_disruption,
    )
    return mean(values) / 4.0


def build_forecast(checkins: Sequence[CheckIn]) -> ForecastResponse:
    usable = len(checkins)
    if usable < 7:
        return ForecastResponse(
            status="insufficient_data",
            model_version=MODEL_VERSION,
            usable_checkins=usable,
            disclaimer=DISCLAIMER,
        )

    recent = list(checkins[-7:])
    latest = recent[-1]
    latest_burden = symptom_burden(latest)
    rolling_burden = mean(symptom_burden(item) for item in recent[-3:])
    sleep_pressure = 1 - (latest.sleep_quality / 4)
    stress_pressure = latest.stress / 4
    period_context = 1.0 if latest.period_status in {"spotting", "flow"} else 0.0

    linear_score = (
        -1.35
        + 1.9 * latest_burden
        + 0.75 * rolling_burden
        + 0.35 * stress_pressure
        + 0.25 * sleep_pressure
        + 0.15 * period_context
    )
    probability = 1 / (1 + math.exp(-linear_score))

    factors: list[ForecastFactor] = []
    if latest_burden >= 0.5:
        factors.append(
            ForecastFactor(
                label="Recent symptom pattern",
                direction="higher",
                detail="Your latest symptom ratings were above your recent lower-burden days.",
            )
        )
    if latest.stress >= 3:
        factors.append(
            ForecastFactor(
                label="Reported stress",
                direction="higher",
                detail="Stress was elevated in your latest check-in.",
            )
        )
    if latest.sleep_quality <= 1:
        factors.append(
            ForecastFactor(
                label="Sleep quality",
                direction="higher",
                detail="Your latest sleep-quality rating was low.",
            )
        )
    if latest.period_status != "none":
        factors.append(
            ForecastFactor(
                label="Cycle context",
                direction="context",
                detail="Your latest check-in reported spotting or flow.",
            )
        )
    if not factors:
        factors.append(
            ForecastFactor(
                label="Recent pattern",
                direction="lower",
                detail="Recent structured signals were comparatively steady.",
            )
        )

    confidence = "low" if usable < 14 else "medium" if usable < 28 else "high"
    return ForecastResponse(
        status="ready",
        probability=round(probability, 3),
        confidence=confidence,
        model_version=MODEL_VERSION,
        usable_checkins=usable,
        factors=factors[:3],
        disclaimer=DISCLAIMER,
    )
