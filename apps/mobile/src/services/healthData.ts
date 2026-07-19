import * as Crypto from "expo-crypto";
import {
  getAvailability as getNativeAvailability,
  openHealthSettings as openNativeHealthSettings,
  readDailySummaries,
  readIntervalSummaries,
  requestPermissions,
} from "expo-health-data";

import {
  cacheWearableDays,
  cacheWearableIntervals,
  cachedWearableDay,
  enqueueWearableSync,
  enqueueWearableIntervalSync,
  getWearableState,
  saveWearableState,
} from "@/services/storage";
import type {
  Result,
  WearableDailyRecord,
  WearableIntervalRecord,
  WearablePlatform,
} from "@/types";
import { localDateString } from "@/utils/date";
import {
  wearableDailyRecordSchema,
  wearableIntervalRecordSchema,
} from "@/validation";

const FOREGROUND_READ_INTERVAL_MS = 12 * 60 * 60 * 1000;
const IMPORT_DAYS = 31;

function currentTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export interface HealthAvailability {
  readonly available: boolean;
  readonly needsInstallOrUpdate: boolean;
  readonly platform: WearablePlatform;
}

export interface HealthReadResult {
  readonly importedDays: number;
  readonly importedIntervals: number;
  readonly metricsFound: ReadonlyArray<keyof WearableDailyRecord>;
  readonly platform: WearablePlatform;
  readonly skipped: boolean;
}

function startDateForImport(): string {
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - (IMPORT_DAYS - 1));
  return localDateString(start);
}

function recordsFromNative(value: unknown): Result<ReadonlyArray<WearableDailyRecord>> {
  if (!Array.isArray(value) || value.length < 1 || value.length > IMPORT_DAYS) {
    return { ok: false, message: "The health store returned an invalid date range." };
  }
  const records: WearableDailyRecord[] = [];
  for (const item of value) {
    const parsed = wearableDailyRecordSchema.safeParse(item);
    if (!parsed.success) {
      return { ok: false, message: "The health store returned an invalid daily summary." };
    }
    records.push(parsed.data);
  }
  return { ok: true, value: records };
}

function intervalsFromNative(
  value: unknown,
): Result<ReadonlyArray<WearableIntervalRecord>> {
  if (!Array.isArray(value) || value.length > IMPORT_DAYS * 4) {
    return { ok: false, message: "The health store returned an invalid interval range." };
  }
  const records: WearableIntervalRecord[] = [];
  const keys = new Set<string>();
  for (const item of value) {
    const parsed = wearableIntervalRecordSchema.safeParse(item);
    if (!parsed.success) {
      return {
        ok: false,
        message: "The health store returned an invalid interval summary.",
      };
    }
    const key = `${parsed.data.observed_date}:${parsed.data.bucket_start_hour}`;
    if (keys.has(key)) {
      return {
        ok: false,
        message: "The health store returned a duplicate interval summary.",
      };
    }
    keys.add(key);
    const bucketEnd = new Date(`${parsed.data.observed_date}T00:00:00`);
    bucketEnd.setHours(parsed.data.bucket_start_hour + 6, 0, 0, 0);
    if (bucketEnd.getTime() <= Date.now()) records.push(parsed.data);
  }
  return { ok: true, value: records };
}

function discoveredMetrics(
  records: ReadonlyArray<WearableDailyRecord>,
): ReadonlyArray<keyof WearableDailyRecord> {
  const metricKeys: ReadonlyArray<keyof WearableDailyRecord> = [
    "sleep_minutes",
    "steps",
    "activity_minutes",
    "active_energy_kcal",
    "resting_heart_rate_bpm",
    "hrv_ms",
    "respiratory_rate_bpm",
    "oxygen_saturation_pct",
    "peripheral_temperature_delta_c",
  ];
  return metricKeys.filter((key) => records.some((record) => record[key] !== null));
}

export function getHealthAvailability(): HealthAvailability {
  try {
    const availability = getNativeAvailability();
    return {
      available: availability.available,
      needsInstallOrUpdate: availability.needs_install_or_update,
      platform: availability.platform,
    };
  } catch {
    return {
      available: false,
      needsInstallOrUpdate: false,
      platform: process.env.EXPO_OS === "android" ? "health_connect" : "apple_health",
    };
  }
}

async function readAndQueue(
  platform: WearablePlatform,
): Promise<Result<HealthReadResult>> {
  try {
    const startDate = startDateForImport();
    const endDate = localDateString();
    const [nativeRows, nativeIntervals]: [unknown, unknown] = await Promise.all([
      readDailySummaries(startDate, endDate),
      readIntervalSummaries(startDate, endDate),
    ]);
    const parsed = recordsFromNative(nativeRows);
    if (!parsed.ok) return parsed;
    const parsedIntervals = intervalsFromNative(nativeIntervals);
    if (!parsedIntervals.ok) return parsedIntervals;
    if (parsed.value.some((record) => record.platform !== platform)) {
      return { ok: false, message: "The health store platform did not match this device." };
    }
    if (parsedIntervals.value.some((record) => record.platform !== platform)) {
      return { ok: false, message: "The health store platform did not match this device." };
    }
    const now = new Date().toISOString();
    // Expo SQLite's standard async transactions share one connection and cannot
    // overlap. Keep local health writes ordered so daily and interval cache
    // transactions do not commit or roll back each other.
    await cacheWearableDays(parsed.value);
    await enqueueWearableSync({
      sync_id: Crypto.randomUUID(),
      records: parsed.value,
    });
    await cacheWearableIntervals(parsedIntervals.value);
    if (parsedIntervals.value.length > 0) {
      await enqueueWearableIntervalSync({
        sync_id: Crypto.randomUUID(),
        records: parsedIntervals.value,
      });
    }
    await saveWearableState(platform, now, currentTimeZone());
    const metricsFound = discoveredMetrics(parsed.value);
    return {
      ok: true,
      value: {
        importedDays: parsed.value.filter((record) =>
          metricsFound.some((key) => record[key] !== null),
        ).length,
        importedIntervals: parsedIntervals.value.length,
        metricsFound,
        platform,
        skipped: false,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Health data could not be read. Check system permissions and try again.",
    };
  }
}

export async function connectHealthData(): Promise<Result<HealthReadResult>> {
  const availability = getHealthAvailability();
  if (!availability.available) {
    return {
      ok: false,
      message: availability.needsInstallOrUpdate
        ? "Install or update Health Connect, then try again."
        : "Health data is unavailable on this device or build.",
    };
  }
  try {
    await requestPermissions();
  } catch (error: unknown) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Health permissions were not completed.",
    };
  }
  return readAndQueue(availability.platform);
}

export async function refreshHealthData(
  force = false,
): Promise<Result<HealthReadResult>> {
  const state = await getWearableState();
  if (!state) {
    return { ok: false, message: "Connect a health app before syncing." };
  }
  if (
    !force &&
    state.time_zone === currentTimeZone() &&
    Date.now() - new Date(state.last_read_at).getTime() < FOREGROUND_READ_INTERVAL_MS
  ) {
    return {
      ok: true,
      value: {
        importedDays: 0,
        importedIntervals: 0,
        metricsFound: [],
        platform: state.platform,
        skipped: true,
      },
    };
  }
  return readAndQueue(state.platform);
}

export async function wearableSleepHoursForDate(
  observedDate: string,
): Promise<number | null> {
  const day = await cachedWearableDay(observedDate);
  return day?.sleep_minutes === null || day?.sleep_minutes === undefined
    ? null
    : Math.round((day.sleep_minutes / 60) * 10) / 10;
}

export function openHealthSettings(): Promise<void> {
  return openNativeHealthSettings();
}
