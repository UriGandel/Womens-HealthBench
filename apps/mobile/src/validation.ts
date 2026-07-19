import { z } from "zod";

export const ratingSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export const checkInSchema = z.object({
  client_submission_id: z.string().min(8).max(64),
  observed_date: z.iso.date(),
  period_status: z.enum(["none", "spotting", "flow"]),
  cycle_day: z.number().int().min(1).max(120).nullable(),
  sleep_hours: z.number().min(0).max(24),
  sleep_quality: ratingSchema,
  stress: ratingSchema,
  fatigue: ratingSchema,
  brain_fog: ratingSchema,
  headache: ratingSchema,
  pelvic_pain: ratingSchema,
  mood_disruption: ratingSchema,
});

export const checkInHistorySchema = z.object({
  days: z.array(
    z.object({
      observed_date: z.iso.date(),
      period_status: z.enum(["none", "spotting", "flow"]),
      sleep_hours: z.number().min(0).max(24),
      sleep_quality: ratingSchema,
      stress: ratingSchema,
      fatigue: ratingSchema,
      brain_fog: ratingSchema,
      headache: ratingSchema,
      pelvic_pain: ratingSchema,
      mood_disruption: ratingSchema,
    }),
  ),
});

export const enrollResponseSchema = z.object({
  access_token: z.string().min(1),
  consent_version: z.string().min(1),
});

export const consentResponseSchema = z.object({
  consent_current: z.boolean(),
  consent_version: z.string().min(1),
  effective_at: z.string(),
});

const forecastFactorSchema = z.object({
  label: z.string(),
  direction: z.enum(["higher", "lower", "context"]),
  detail: z.string(),
});

export const forecastResponseSchema = z.object({
  status: z.enum(["ready", "insufficient_data"]),
  probability: z.number().min(0).max(1).nullable(),
  confidence: z.enum(["low", "medium", "high"]).nullable(),
  model_version: z.string(),
  horizon: z.string(),
  usable_checkins: z.number().int().nonnegative(),
  required_checkins: z.number().int().positive(),
  factors: z.array(forecastFactorSchema),
  disclaimer: z.string(),
});

export const accountSummarySchema = z.object({
  consent_current: z.boolean(),
  consent_version: z.string(),
  checkin_count: z.number().int().nonnegative(),
  research_record_count: z.number().int().nonnegative(),
  wearable_connected: z.boolean(),
  wearable_platform: z.enum(["apple_health", "health_connect"]).nullable(),
  wearable_day_count: z.number().int().nonnegative(),
  wearable_last_synced_at: z.string().nullable(),
});

export const wearableDailyRecordSchema = z
  .object({
    observed_date: z.iso.date(),
    platform: z.enum(["apple_health", "health_connect"]),
    sleep_minutes: z.number().int().min(0).max(1440).nullable(),
    steps: z.number().int().min(0).max(500_000).nullable(),
    activity_minutes: z.number().int().min(0).max(1440).nullable(),
    active_energy_kcal: z.number().min(0).max(50_000).nullable(),
    resting_heart_rate_bpm: z.number().min(20).max(300).nullable(),
    hrv_ms: z.number().min(0).max(1000).nullable(),
    hrv_method: z.enum(["sdnn", "rmssd"]).nullable(),
    respiratory_rate_bpm: z.number().min(1).max(100).nullable(),
    oxygen_saturation_pct: z.number().min(0).max(100).nullable(),
    peripheral_temperature_delta_c: z.number().min(-20).max(20).nullable(),
  })
  .refine((value) => (value.hrv_ms === null) === (value.hrv_method === null), {
    message: "HRV value and method must be present together.",
  });

export const wearableSyncResponseSchema = z.object({
  accepted_days: z.number().int().nonnegative(),
  deleted_days: z.number().int().nonnegative(),
  duplicate: z.boolean(),
  last_synced_at: z.string(),
});

export const wearableDeleteResponseSchema = z.object({
  deleted_days: z.number().int().nonnegative(),
  message: z.string(),
});

export const messageResponseSchema = z.object({
  message: z.string(),
});
