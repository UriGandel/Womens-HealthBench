from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Rating = Literal[0, 1, 2, 3, 4]
PeriodStatus = Literal["none", "spotting", "flow"]


class EnrollRequest(BaseModel):
    invitation_code: str = Field(min_length=4, max_length=64)
    adult_confirmed: bool
    operational_consent: bool
    research_opt_in: bool = False
    consent_version: str
    seed_demo_history: bool = False


class EnrollResponse(BaseModel):
    access_token: str
    consent_version: str
    research_opt_in: bool
    demo_history_seeded: bool


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


class ResearchConsentUpdate(BaseModel):
    research_opt_in: bool
    consent_version: str
    contribute_existing: bool = False


class ResearchConsentResponse(BaseModel):
    research_opt_in: bool
    effective_at: datetime
    contributed_records: int


class AccountSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    research_opt_in: bool
    consent_version: str
    checkin_count: int
    research_record_count: int


class MessageResponse(BaseModel):
    message: str

