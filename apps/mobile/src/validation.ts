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

const phaseForecastResponseBase = {
  model_version: z.literal("mcphases-app-common-0.2.0"),
  usable_days: z.number().int().nonnegative(),
  required_days: z.literal(4),
  lookback_days: z.literal(7),
  disclaimer: z.string(),
} as const;

export const phaseForecastResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      ...phaseForecastResponseBase,
      status: z.literal("ready"),
      predicted_phase: z.enum([
        "Fertility",
        "Follicular",
        "Luteal",
        "Menstrual",
      ]),
    })
    .strict(),
  z
    .object({
      ...phaseForecastResponseBase,
      status: z.literal("insufficient_data"),
      predicted_phase: z.null(),
    })
    .strict(),
  z
    .object({
      ...phaseForecastResponseBase,
      status: z.literal("model_unavailable"),
      predicted_phase: z.null(),
    })
    .strict(),
]);

export const accountSummarySchema = z.object({
  consent_current: z.boolean(),
  consent_version: z.string(),
  checkin_count: z.number().int().nonnegative(),
  research_record_count: z.number().int().nonnegative(),
  wearable_connected: z.boolean(),
  wearable_platform: z.enum(["apple_health", "health_connect"]).nullable(),
  wearable_day_count: z.number().int().nonnegative(),
  wearable_interval_count: z.number().int().nonnegative(),
  wearable_last_synced_at: z.string().nullable(),
  cycle_tracking_enabled: z.boolean(),
  cycle_day_count: z.number().int().nonnegative(),
});

export const cycleDayRecordSchema = z.object({
  observed_date: z.iso.date(),
  period_status: z.enum(["spotting", "flow"]).nullable(),
});

const cyclePatternSchema = z.object({
  label: z.string(),
  direction: z.enum(["higher", "lower"]),
  detail: z.string(),
});

export const cycleTrackingSummarySchema = z.object({
  enabled: z.boolean(),
  days: z.array(cycleDayRecordSchema),
  current_cycle_day: z.number().int().min(1).max(120).nullable(),
  cycle_started_on: z.iso.date().nullable(),
  observed_cycle_length_days: z.number().min(1).max(120).nullable(),
  cycle_start_count: z.number().int().nonnegative(),
  pattern_status: z.enum(["ready", "insufficient_data"]),
  patterns: z.array(cyclePatternSchema),
  prediction_status: z.enum(["ready", "insufficient_data", "variable"]),
  prediction_confidence: z.enum(["low", "medium", "high"]).nullable(),
  projected_through: z.iso.date().nullable(),
  predicted_period_windows: z.array(
    z.object({
      start_date: z.iso.date(),
      end_date: z.iso.date(),
      confidence: z.enum(["low", "medium"]),
    }),
  ),
  phase_days: z.array(
    z.object({
      observed_date: z.iso.date(),
      phase: z.enum(["menstrual", "follicular", "ovulatory", "luteal"]),
      predicted: z.boolean(),
      confidence: z.enum(["low", "medium", "high"]),
    }),
  ),
});

export const cycleSyncResponseSchema = z.object({
  accepted_days: z.number().int().nonnegative(),
  deleted_days: z.number().int().nonnegative(),
  duplicate: z.boolean(),
});

export const cycleDeleteResponseSchema = z.object({
  deleted_days: z.number().int().nonnegative(),
  message: z.string(),
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

const nullableSampleCountSchema = z.number().int().min(1).max(100_000).nullable();

export const wearableIntervalRecordSchema = z
  .object({
    observed_date: z.iso.date(),
    bucket_start_hour: z.union([
      z.literal(0),
      z.literal(6),
      z.literal(12),
      z.literal(18),
    ]),
    platform: z.enum(["apple_health", "health_connect"]),
    steps: z.number().int().min(0).max(250_000).nullable(),
    activity_minutes: z.number().int().min(0).max(480).nullable(),
    active_energy_kcal: z.number().min(0).max(25_000).nullable(),
    heart_rate_avg_bpm: z.number().min(20).max(300).nullable(),
    heart_rate_min_bpm: z.number().min(20).max(300).nullable(),
    heart_rate_max_bpm: z.number().min(20).max(300).nullable(),
    heart_rate_sample_count: nullableSampleCountSchema,
    hrv_avg_ms: z.number().min(0).max(1000).nullable(),
    hrv_sample_count: nullableSampleCountSchema,
    hrv_method: z.enum(["sdnn", "rmssd"]).nullable(),
    respiratory_rate_avg_bpm: z.number().min(1).max(100).nullable(),
    respiratory_rate_sample_count: nullableSampleCountSchema,
    oxygen_saturation_avg_pct: z.number().min(0).max(100).nullable(),
    oxygen_saturation_sample_count: nullableSampleCountSchema,
  })
  .superRefine((value, context) => {
    const pairedValues: ReadonlyArray<
      readonly [number | null, number | null, string]
    > = [
      [value.heart_rate_avg_bpm, value.heart_rate_sample_count, "heart rate"],
      [value.hrv_avg_ms, value.hrv_sample_count, "HRV"],
      [
        value.respiratory_rate_avg_bpm,
        value.respiratory_rate_sample_count,
        "respiratory rate",
      ],
      [
        value.oxygen_saturation_avg_pct,
        value.oxygen_saturation_sample_count,
        "oxygen saturation",
      ],
    ];
    for (const [metric, count, label] of pairedValues) {
      if ((metric === null) !== (count === null)) {
        context.addIssue({
          code: "custom",
          message: `${label} value and sample count must be present together.`,
        });
      }
    }
    if ((value.hrv_avg_ms === null) !== (value.hrv_method === null)) {
      context.addIssue({
        code: "custom",
        message: "HRV value and method must be present together.",
      });
    }
    const heartRateValues = [
      value.heart_rate_avg_bpm,
      value.heart_rate_min_bpm,
      value.heart_rate_max_bpm,
    ];
    if (
      heartRateValues.some((metric) => metric === null) &&
      heartRateValues.some((metric) => metric !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Heart-rate average, minimum, and maximum must be present together.",
      });
    }
    if (
      value.heart_rate_avg_bpm !== null &&
      value.heart_rate_min_bpm !== null &&
      value.heart_rate_max_bpm !== null &&
      !(
        value.heart_rate_min_bpm <= value.heart_rate_avg_bpm &&
        value.heart_rate_avg_bpm <= value.heart_rate_max_bpm
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Heart-rate minimum cannot exceed the maximum.",
      });
    }
  });

export const wearableIntervalSyncResponseSchema = z.object({
  accepted_intervals: z.number().int().nonnegative(),
  deleted_intervals: z.number().int().nonnegative(),
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
