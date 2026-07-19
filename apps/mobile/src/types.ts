export type Rating = 0 | 1 | 2 | 3 | 4;
export type PeriodStatus = "none" | "spotting" | "flow";
export type CycleStatus = "spotting" | "flow";
export type Confidence = "low" | "medium" | "high";

export interface EnrollRequest {
  readonly adult_confirmed: boolean;
  readonly operational_consent: boolean;
  readonly research_consent: boolean;
  readonly consent_version: string;
}

export interface EnrollResponse {
  readonly access_token: string;
  readonly consent_version: string;
}

export interface ConsentResponse {
  readonly consent_current: boolean;
  readonly consent_version: string;
  readonly effective_at: string;
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
  readonly consent_current: boolean;
  readonly consent_version: string;
  readonly checkin_count: number;
  readonly research_record_count: number;
  readonly wearable_connected: boolean;
  readonly wearable_platform: WearablePlatform | null;
  readonly wearable_day_count: number;
  readonly wearable_last_synced_at: string | null;
  readonly cycle_tracking_enabled: boolean;
  readonly cycle_day_count: number;
}

export interface CycleDayRecord {
  readonly observed_date: string;
  readonly period_status: CycleStatus | null;
}

export interface CycleSyncRequest {
  readonly sync_id: string;
  readonly local_today: string;
  readonly records: ReadonlyArray<CycleDayRecord>;
}

export interface CycleSyncResponse {
  readonly accepted_days: number;
  readonly deleted_days: number;
  readonly duplicate: boolean;
}

export interface CyclePattern {
  readonly label: string;
  readonly direction: "higher" | "lower";
  readonly detail: string;
}

export interface CycleTrackingSummary {
  readonly enabled: boolean;
  readonly days: ReadonlyArray<CycleDayRecord>;
  readonly current_cycle_day: number | null;
  readonly cycle_started_on: string | null;
  readonly observed_cycle_length_days: number | null;
  readonly cycle_start_count: number;
  readonly pattern_status: "ready" | "insufficient_data";
  readonly patterns: ReadonlyArray<CyclePattern>;
}

export interface CycleDeleteResponse {
  readonly deleted_days: number;
  readonly message: string;
}

export type WearablePlatform = "apple_health" | "health_connect";
export type HrvMethod = "sdnn" | "rmssd";

export interface WearableDailyRecord {
  readonly observed_date: string;
  readonly platform: WearablePlatform;
  readonly sleep_minutes: number | null;
  readonly steps: number | null;
  readonly activity_minutes: number | null;
  readonly active_energy_kcal: number | null;
  readonly resting_heart_rate_bpm: number | null;
  readonly hrv_ms: number | null;
  readonly hrv_method: HrvMethod | null;
  readonly respiratory_rate_bpm: number | null;
  readonly oxygen_saturation_pct: number | null;
  readonly peripheral_temperature_delta_c: number | null;
}

export interface WearableSyncRequest {
  readonly sync_id: string;
  readonly records: ReadonlyArray<WearableDailyRecord>;
}

export interface WearableSyncResponse {
  readonly accepted_days: number;
  readonly deleted_days: number;
  readonly duplicate: boolean;
  readonly last_synced_at: string;
}

export interface WearableDeleteResponse {
  readonly deleted_days: number;
  readonly message: string;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string; readonly status?: number };
