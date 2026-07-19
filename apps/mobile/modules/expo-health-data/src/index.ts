import { requireOptionalNativeModule } from "expo";

export type HealthDataPlatform = "apple_health" | "health_connect";

export interface NativeHealthAvailability {
  readonly available: boolean;
  readonly needs_install_or_update: boolean;
  readonly platform: HealthDataPlatform;
}

export interface NativeHealthPermissionResult {
  readonly granted: ReadonlyArray<string>;
  readonly platform: HealthDataPlatform;
}

export interface NativeHealthDay {
  readonly observed_date: string;
  readonly platform: HealthDataPlatform;
  readonly sleep_minutes: number | null;
  readonly steps: number | null;
  readonly activity_minutes: number | null;
  readonly active_energy_kcal: number | null;
  readonly resting_heart_rate_bpm: number | null;
  readonly hrv_ms: number | null;
  readonly hrv_method: "sdnn" | "rmssd" | null;
  readonly respiratory_rate_bpm: number | null;
  readonly oxygen_saturation_pct: number | null;
  readonly peripheral_temperature_delta_c: number | null;
}

export interface NativeHealthInterval {
  readonly observed_date: string;
  readonly bucket_start_hour: 0 | 6 | 12 | 18;
  readonly platform: HealthDataPlatform;
  readonly steps: number | null;
  readonly activity_minutes: number | null;
  readonly active_energy_kcal: number | null;
  readonly heart_rate_avg_bpm: number | null;
  readonly heart_rate_min_bpm: number | null;
  readonly heart_rate_max_bpm: number | null;
  readonly heart_rate_sample_count: number | null;
  readonly hrv_avg_ms: number | null;
  readonly hrv_sample_count: number | null;
  readonly hrv_method: "sdnn" | "rmssd" | null;
  readonly respiratory_rate_avg_bpm: number | null;
  readonly respiratory_rate_sample_count: number | null;
  readonly oxygen_saturation_avg_pct: number | null;
  readonly oxygen_saturation_sample_count: number | null;
}

interface ExpoHealthDataNativeModule {
  readonly getAvailability: () => NativeHealthAvailability;
  readonly requestPermissions: () => Promise<NativeHealthPermissionResult>;
  readonly readDailySummaries: (
    startDate: string,
    endDate: string,
  ) => Promise<ReadonlyArray<NativeHealthDay>>;
  readonly readIntervalSummaries: (
    startDate: string,
    endDate: string,
  ) => Promise<ReadonlyArray<NativeHealthInterval>>;
  readonly openHealthSettings: () => Promise<void>;
}

const nativeModule =
  requireOptionalNativeModule<ExpoHealthDataNativeModule>("ExpoHealthData");

export function getAvailability(): NativeHealthAvailability {
  if (!nativeModule) {
    return {
      available: false,
      needs_install_or_update: false,
      platform: process.env.EXPO_OS === "android" ? "health_connect" : "apple_health",
    };
  }
  return nativeModule.getAvailability();
}

export function requestPermissions(): Promise<NativeHealthPermissionResult> {
  if (!nativeModule) {
    return Promise.reject(
      new Error("Health data requires an iOS or Android development build."),
    );
  }
  return nativeModule.requestPermissions();
}

export function readDailySummaries(
  startDate: string,
  endDate: string,
): Promise<ReadonlyArray<NativeHealthDay>> {
  if (!nativeModule) {
    return Promise.reject(
      new Error("Health data requires an iOS or Android development build."),
    );
  }
  return nativeModule.readDailySummaries(startDate, endDate);
}

export function readIntervalSummaries(
  startDate: string,
  endDate: string,
): Promise<ReadonlyArray<NativeHealthInterval>> {
  if (!nativeModule) {
    return Promise.reject(
      new Error("Health data requires an iOS or Android development build."),
    );
  }
  return nativeModule.readIntervalSummaries(startDate, endDate);
}

export function openHealthSettings(): Promise<void> {
  if (!nativeModule) return Promise.resolve();
  return nativeModule.openHealthSettings();
}
