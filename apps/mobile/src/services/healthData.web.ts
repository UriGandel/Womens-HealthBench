import { cachedWearableDay } from "@/services/storage";
import type {
  Result,
  WearableDailyRecord,
  WearablePlatform,
} from "@/types";

export interface HealthAvailability {
  readonly available: boolean;
  readonly needsInstallOrUpdate: boolean;
  readonly platform: WearablePlatform;
}

export interface HealthReadResult {
  readonly importedDays: number;
  readonly metricsFound: ReadonlyArray<keyof WearableDailyRecord>;
  readonly platform: WearablePlatform;
  readonly skipped: boolean;
}

const BROWSER_UNAVAILABLE =
  "Health data is unavailable in a browser. Use an iOS or Android development build.";

export function getHealthAvailability(): HealthAvailability {
  return {
    available: false,
    needsInstallOrUpdate: false,
    platform: "apple_health",
  };
}

export async function connectHealthData(): Promise<Result<HealthReadResult>> {
  return { ok: false, message: BROWSER_UNAVAILABLE };
}

export async function refreshHealthData(): Promise<Result<HealthReadResult>> {
  return { ok: false, message: BROWSER_UNAVAILABLE };
}

export async function wearableSleepHoursForDate(
  observedDate: string,
): Promise<number | null> {
  const day = await cachedWearableDay(observedDate);
  return day?.sleep_minutes === null || day?.sleep_minutes === undefined
    ? null
    : Math.round((day.sleep_minutes / 60) * 10) / 10;
}

export async function openHealthSettings(): Promise<void> {
  // System health settings are not available in a browser.
}
