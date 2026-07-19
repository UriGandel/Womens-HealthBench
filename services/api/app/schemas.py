from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictFloat, model_validator

Rating = Literal[0, 1, 2, 3, 4]
PeriodStatus = Literal["none", "spotting", "flow"]
CycleStatus = Literal["spotting", "flow"]


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


PhaseLabel = Literal["Fertility", "Follicular", "Luteal", "Menstrual"]


class BroadPhasePredictionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    features: dict[str, StrictFloat | None] = Field(min_length=161, max_length=161)


class BroadPhasePredictionResponse(BaseModel):
    status: Literal["ready", "insufficient_data", "model_unavailable"]
    predicted_phase: PhaseLabel | None = None
    model_version: str = "mcphases-broad-0.1.0"
    feature_count: int = 161
    disclaimer: str

    @model_validator(mode="after")
    def phase_matches_status(self) -> "BroadPhasePredictionResponse":
        if (self.status == "ready") != (self.predicted_phase is not None):
            raise ValueError("predicted_phase must be present only when status is ready")
        return self


class BroadPhaseModelMetadata(BaseModel):
    model_version: str = "mcphases-broad-0.1.0"
    status: Literal["ready", "model_unavailable"]
    task: str = "Current-day four-class phase prediction from seven prior complete days"
    prediction_timestamp: str = "Start of the target calendar day"
    feature_count: int = 161
    feature_names: list[str]
    output_classes: list[PhaseLabel]
    lookback_days: int = 7
    required_days: int = 4
    test_macro_f1: float = 0.307
    test_macro_f1_ci95: tuple[float, float] = (0.257, 0.357)
    limitations: list[str] = Field(
        default_factory=lambda: [
            "Accepts pre-engineered mcPHASES-style features, not direct app records",
            "Experimental research prototype; not clinically validated",
            "Probability calibration is poor, so probabilities are withheld",
        ]
    )
    disclaimer: str


class PhaseForecastResponse(BaseModel):
    status: Literal["ready", "insufficient_data", "model_unavailable"]
    predicted_phase: PhaseLabel | None = None
    model_version: str = "mcphases-app-common-0.2.0"
    usable_days: int
    required_days: int = 4
    lookback_days: int = 7
    disclaimer: str

    @model_validator(mode="after")
    def phase_matches_status(self) -> "PhaseForecastResponse":
        if (self.status == "ready") != (self.predicted_phase is not None):
            raise ValueError("predicted_phase must be present only when status is ready")
        return self


class AccountSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    consent_current: bool
    consent_version: str
    checkin_count: int
    research_record_count: int
    wearable_connected: bool
    wearable_platform: Literal["apple_health", "health_connect"] | None = None
    wearable_day_count: int
    wearable_interval_count: int
    wearable_last_synced_at: datetime | None = None
    cycle_tracking_enabled: bool
    cycle_day_count: int


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


class WearableIntervalRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    observed_date: date
    bucket_start_hour: Literal[0, 6, 12, 18]
    platform: Literal["apple_health", "health_connect"]
    steps: int | None = Field(default=None, ge=0, le=250_000)
    activity_minutes: int | None = Field(default=None, ge=0, le=480)
    active_energy_kcal: float | None = Field(default=None, ge=0, le=25_000)
    heart_rate_avg_bpm: float | None = Field(default=None, ge=20, le=300)
    heart_rate_min_bpm: float | None = Field(default=None, ge=20, le=300)
    heart_rate_max_bpm: float | None = Field(default=None, ge=20, le=300)
    heart_rate_sample_count: int | None = Field(default=None, ge=1, le=100_000)
    hrv_avg_ms: float | None = Field(default=None, ge=0, le=1000)
    hrv_sample_count: int | None = Field(default=None, ge=1, le=100_000)
    hrv_method: Literal["sdnn", "rmssd"] | None = None
    respiratory_rate_avg_bpm: float | None = Field(default=None, ge=1, le=100)
    respiratory_rate_sample_count: int | None = Field(default=None, ge=1, le=100_000)
    oxygen_saturation_avg_pct: float | None = Field(default=None, ge=0, le=100)
    oxygen_saturation_sample_count: int | None = Field(default=None, ge=1, le=100_000)

    @model_validator(mode="after")
    def paired_values_are_consistent(self) -> "WearableIntervalRecord":
        pairs = (
            (self.heart_rate_avg_bpm, self.heart_rate_sample_count, "heart rate"),
            (self.hrv_avg_ms, self.hrv_sample_count, "HRV"),
            (
                self.respiratory_rate_avg_bpm,
                self.respiratory_rate_sample_count,
                "respiratory rate",
            ),
            (
                self.oxygen_saturation_avg_pct,
                self.oxygen_saturation_sample_count,
                "oxygen saturation",
            ),
        )
        for value, count, label in pairs:
            if (value is None) != (count is None):
                raise ValueError(f"{label} value and sample count must be provided together")
        if (self.hrv_avg_ms is None) != (self.hrv_method is None):
            raise ValueError("HRV value and method must be provided together")
        if (
            self.heart_rate_min_bpm is None
            or self.heart_rate_max_bpm is None
        ) != (self.heart_rate_avg_bpm is None):
            raise ValueError("heart-rate average, minimum, and maximum must be provided together")
        if (
            self.heart_rate_min_bpm is not None
            and self.heart_rate_avg_bpm is not None
            and self.heart_rate_max_bpm is not None
            and not (
                self.heart_rate_min_bpm
                <= self.heart_rate_avg_bpm
                <= self.heart_rate_max_bpm
            )
        ):
            raise ValueError("heart-rate minimum, average, and maximum are inconsistent")
        return self

    def has_metrics(self) -> bool:
        return any(
            value is not None
            for field, value in self.model_dump().items()
            if field
            not in {
                "observed_date",
                "bucket_start_hour",
                "platform",
                "hrv_method",
                "heart_rate_sample_count",
                "hrv_sample_count",
                "respiratory_rate_sample_count",
                "oxygen_saturation_sample_count",
            }
        )


class WearableIntervalSyncRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sync_id: str = Field(min_length=8, max_length=64)
    records: list[WearableIntervalRecord] = Field(min_length=1, max_length=124)

    @model_validator(mode="after")
    def interval_keys_are_unique(self) -> "WearableIntervalSyncRequest":
        keys = [(record.observed_date, record.bucket_start_hour) for record in self.records]
        if len(keys) != len(set(keys)):
            raise ValueError("wearable interval records must have unique date/bucket keys")
        return self


class WearableIntervalSyncResponse(BaseModel):
    accepted_intervals: int
    deleted_intervals: int
    duplicate: bool
    last_synced_at: datetime


class WearableDeleteResponse(BaseModel):
    deleted_days: int
    message: str


class CycleTrackingEnableRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    acknowledged_sensitive_data: bool
    local_today: date

    @model_validator(mode="after")
    def acknowledgement_is_required(self) -> "CycleTrackingEnableRequest":
        if not self.acknowledged_sensitive_data:
            raise ValueError("cycle tracking requires an explicit acknowledgement")
        return self


class CycleDayRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    observed_date: date
    period_status: CycleStatus | None


class CycleSyncRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sync_id: str = Field(min_length=8, max_length=64)
    local_today: date
    records: list[CycleDayRecord] = Field(min_length=1, max_length=120)

    @model_validator(mode="after")
    def dates_are_unique(self) -> "CycleSyncRequest":
        dates = [record.observed_date for record in self.records]
        if len(dates) != len(set(dates)):
            raise ValueError("cycle records must contain unique observed dates")
        return self


class CycleSyncResponse(BaseModel):
    accepted_days: int
    deleted_days: int
    duplicate: bool


class CyclePattern(BaseModel):
    label: str
    direction: Literal["higher", "lower"]
    detail: str


class CyclePhaseDay(BaseModel):
    observed_date: date
    phase: Literal["menstrual", "follicular", "ovulatory", "luteal"]
    predicted: bool
    confidence: Literal["low", "medium", "high"]


class PredictedPeriodWindow(BaseModel):
    start_date: date
    end_date: date
    confidence: Literal["low", "medium"]


class CycleTrackingSummary(BaseModel):
    enabled: bool
    days: list[CycleDayRecord] = Field(default_factory=list)
    current_cycle_day: int | None = None
    cycle_started_on: date | None = None
    observed_cycle_length_days: float | None = None
    cycle_start_count: int = 0
    pattern_status: Literal["ready", "insufficient_data"] = "insufficient_data"
    patterns: list[CyclePattern] = Field(default_factory=list)
    prediction_status: Literal["ready", "insufficient_data", "variable"] = (
        "insufficient_data"
    )
    prediction_confidence: Literal["low", "medium", "high"] | None = None
    projected_through: date | None = None
    phase_days: list[CyclePhaseDay] = Field(default_factory=list)
    predicted_period_windows: list[PredictedPeriodWindow] = Field(default_factory=list)


class CycleDeleteResponse(BaseModel):
    deleted_days: int
    message: str


class MessageResponse(BaseModel):
    message: str
