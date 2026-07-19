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

export const enrollResponseSchema = z.object({
  access_token: z.string().min(1),
  consent_version: z.string().min(1),
  research_opt_in: z.boolean(),
  demo_history_seeded: z.boolean(),
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
  research_opt_in: z.boolean(),
  consent_version: z.string(),
  checkin_count: z.number().int().nonnegative(),
  research_record_count: z.number().int().nonnegative(),
});

export const researchConsentResponseSchema = z.object({
  research_opt_in: z.boolean(),
  effective_at: z.string(),
  contributed_records: z.number().int().nonnegative(),
});

export const messageResponseSchema = z.object({
  message: z.string(),
});
