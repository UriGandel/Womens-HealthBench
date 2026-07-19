from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Rating = Literal[0, 1, 2, 3, 4]
PeriodStatus = Literal["none", "spotting", "flow"]


class EnrollRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    adult_confirmed: bool
    operational_consent: bool
    research_consent: bool
    consent_version: str


class EnrollResponse(BaseModel):
    access_token: str
    consent_version: str


class ConsentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operational_consent: bool
    research_consent: bool
    consent_version: str


class ConsentResponse(BaseModel):
    consent_current: bool
    consent_version: str
    effective_at: datetime


class CheckInCreate(BaseModel):
    client_submission_id: str = Field(min_length=8, max_length=64)
    observed_date: date
    period_status: PeriodStatus
    cycle_day: int | None = Field(default=None, ge=1, le=120)
    sleep_hours: float = Field(ge=0, le=24)
    sleep_quality: Rating
    stress: Rating
    fatigue: Rating
    brain_fog: Rating
    headache: Rating
    pelvic_pain: Rating
    mood_disruption: Rating

    @model_validator(mode="after")
    def cycle_day_is_optional_but_plausible(self) -> "CheckInCreate":
        if self.period_status == "flow" and self.cycle_day is not None and self.cycle_day > 14:
            return self
        return self


class CheckInResponse(BaseModel):
    id: str
    accepted: bool
    duplicate: bool
    research_contributed: bool
    queued_at: datetime


# Read model for the mobile "last 14 days" history strip. Intentionally
# excludes ids and timestamps — the client only needs per-day observations.
class CheckInHistoryDay(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    observed_date: date
    period_status: PeriodStatus
    sleep_hours: float
    sleep_quality: Rating
    stress: Rating
    fatigue: Rating
    brain_fog: Rating
    headache: Rating
    pelvic_pain: Rating
    mood_disruption: Rating


class CheckInHistoryResponse(BaseModel):
    days: list[CheckInHistoryDay]


class ForecastFactor(BaseModel):
    label: str
    direction: Literal["higher", "lower", "context"]
    detail: str


class ForecastResponse(BaseModel):
    status: Literal["ready", "insufficient_data"]
    probability: float | None = None
    confidence: Literal["low", "medium", "high"] | None = None
    model_version: str
    horizon: str = "tomorrow"
    usable_checkins: int
    required_checkins: int = 7
    factors: list[ForecastFactor] = Field(default_factory=list)
    disclaimer: str


class AccountSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    consent_current: bool
    consent_version: str
    checkin_count: int
    research_record_count: int
    wearable_connected: bool
    wearable_platform: Literal["apple_health", "health_connect"] | None = None
    wearable_day_count: int
    wearable_last_synced_at: datetime | None = None


class WearableDailyRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    observed_date: date
    platform: Literal["apple_health", "health_connect"]
    sleep_minutes: int | None = Field(default=None, ge=0, le=1440)
    steps: int | None = Field(default=None, ge=0, le=500_000)
    activity_minutes: int | None = Field(default=None, ge=0, le=1440)
    active_energy_kcal: float | None = Field(default=None, ge=0, le=50_000)
    resting_heart_rate_bpm: float | None = Field(default=None, ge=20, le=300)
    hrv_ms: float | None = Field(default=None, ge=0, le=1000)
    hrv_method: Literal["sdnn", "rmssd"] | None = None
    respiratory_rate_bpm: float | None = Field(default=None, ge=1, le=100)
    oxygen_saturation_pct: float | None = Field(default=None, ge=0, le=100)
    peripheral_temperature_delta_c: float | None = Field(default=None, ge=-20, le=20)

    @model_validator(mode="after")
    def hrv_value_and_method_are_paired(self) -> "WearableDailyRecord":
        if (self.hrv_ms is None) != (self.hrv_method is None):
            raise ValueError("hrv_ms and hrv_method must be provided together")
        return self

    def has_metrics(self) -> bool:
        return any(
            value is not None
            for field, value in self.model_dump().items()
            if field not in {"observed_date", "platform", "hrv_method"}
        )


class WearableSyncRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sync_id: str = Field(min_length=8, max_length=64)
    records: list[WearableDailyRecord] = Field(min_length=1, max_length=31)

    @model_validator(mode="after")
    def dates_are_unique(self) -> "WearableSyncRequest":
        dates = [record.observed_date for record in self.records]
        if len(dates) != len(set(dates)):
            raise ValueError("wearable records must contain unique observed dates")
        return self


class WearableSyncResponse(BaseModel):
    accepted_days: int
    deleted_days: int
    duplicate: bool
    last_synced_at: datetime


class WearableDeleteResponse(BaseModel):
    deleted_days: int
    message: str


class MessageResponse(BaseModel):
    message: str
