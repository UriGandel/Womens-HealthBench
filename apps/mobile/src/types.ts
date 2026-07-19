export type Rating = 0 | 1 | 2 | 3 | 4;
export type PeriodStatus = "none" | "spotting" | "flow";
export type Confidence = "low" | "medium" | "high";

export interface EnrollRequest {
  readonly invitation_code: string;
  readonly adult_confirmed: boolean;
  readonly operational_consent: boolean;
  readonly research_opt_in: boolean;
  readonly consent_version: string;
  readonly seed_demo_history: boolean;
}

export interface EnrollResponse {
  readonly access_token: string;
  readonly consent_version: string;
  readonly research_opt_in: boolean;
  readonly demo_history_seeded: boolean;
}

export interface CheckInCreate {
  readonly client_submission_id: string;
  readonly observed_date: string;
  readonly period_status: PeriodStatus;
  readonly cycle_day: number | null;
  readonly sleep_hours: number;
  readonly sleep_quality: Rating;
  readonly stress: Rating;
  readonly fatigue: Rating;
  readonly brain_fog: Rating;
  readonly headache: Rating;
  readonly pelvic_pain: Rating;
  readonly mood_disruption: Rating;
}

export interface ForecastFactor {
  readonly label: string;
  readonly direction: "higher" | "lower" | "context";
  readonly detail: string;
}

export interface ForecastResponse {
  readonly status: "ready" | "insufficient_data";
  readonly probability: number | null;
  readonly confidence: Confidence | null;
  readonly model_version: string;
  readonly horizon: string;
  readonly usable_checkins: number;
  readonly required_checkins: number;
  readonly factors: ReadonlyArray<ForecastFactor>;
  readonly disclaimer: string;
}

export interface AccountSummary {
  readonly research_opt_in: boolean;
  readonly consent_version: string;
  readonly checkin_count: number;
  readonly research_record_count: number;
}

export interface ResearchConsentResponse {
  readonly research_opt_in: boolean;
  readonly effective_at: string;
  readonly contributed_records: number;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string; readonly status?: number };
