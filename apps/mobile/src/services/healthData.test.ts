import { beforeEach, expect, jest, test } from "@jest/globals";

import {
  connectHealthData,
  getHealthAvailability,
  wearableSleepHoursForDate,
} from "@/services/healthData";
import {
  cacheWearableDays,
  cacheWearableIntervals,
  cachedWearableDay,
  enqueueWearableSync,
  enqueueWearableIntervalSync,
  saveWearableState,
} from "@/services/storage";
import {
  getAvailability,
  readDailySummaries,
  readIntervalSummaries,
  requestPermissions,
} from "expo-health-data";
import { localDateString } from "@/utils/date";

jest.mock("expo-health-data", () => ({
  getAvailability: jest.fn(),
  openHealthSettings: jest.fn(),
  readDailySummaries: jest.fn(),
  readIntervalSummaries: jest.fn(),
  requestPermissions: jest.fn(),
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "health-sync-uuid" }));
jest.mock("@/services/storage", () => ({
  cacheWearableDays: jest.fn(),
  cacheWearableIntervals: jest.fn(),
  cachedWearableDay: jest.fn(),
  enqueueWearableSync: jest.fn(),
  enqueueWearableIntervalSync: jest.fn(),
  getWearableState: jest.fn(),
  saveWearableState: jest.fn(),
}));

const mockedAvailability = jest.mocked(getAvailability);
const mockedRead = jest.mocked(readDailySummaries);
const mockedIntervalRead = jest.mocked(readIntervalSummaries);
const mockedPermissions = jest.mocked(requestPermissions);

const dailyRecord = {
  observed_date: "2026-07-19",
  platform: "apple_health" as const,
  sleep_minutes: null,
  steps: 0,
  activity_minutes: null,
  active_energy_kcal: null,
  resting_heart_rate_bpm: null,
  hrv_ms: null,
  hrv_method: null,
  respiratory_rate_bpm: null,
  oxygen_saturation_pct: null,
  peripheral_temperature_delta_c: null,
};

const intervalRecord = {
  observed_date: "2026-07-18",
  bucket_start_hour: 18 as const,
  platform: "apple_health" as const,
  steps: 0,
  activity_minutes: null,
  active_energy_kcal: null,
  heart_rate_avg_bpm: 72,
  heart_rate_min_bpm: 60,
  heart_rate_max_bpm: 90,
  heart_rate_sample_count: 8,
  hrv_avg_ms: null,
  hrv_sample_count: null,
  hrv_method: null,
  respiratory_rate_avg_bpm: null,
  respiratory_rate_sample_count: null,
  oxygen_saturation_avg_pct: null,
  oxygen_saturation_sample_count: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedAvailability.mockReturnValue({
    available: true,
    needs_install_or_update: false,
    platform: "apple_health",
  });
  mockedPermissions.mockResolvedValue({
    granted: [],
    platform: "apple_health",
  });
  mockedRead.mockResolvedValue([dailyRecord]);
  mockedIntervalRead.mockResolvedValue([intervalRecord]);
});

test("reports an unavailable health store without requesting permissions", async () => {
  mockedAvailability.mockReturnValue({
    available: false,
    needs_install_or_update: false,
    platform: "apple_health",
  });

  expect(getHealthAvailability().available).toBe(false);
  await expect(connectHealthData()).resolves.toEqual({
    ok: false,
    message: "Health data is unavailable on this device or build.",
  });
  expect(mockedPermissions).not.toHaveBeenCalled();
});

test("surfaces denied or revoked permission failures", async () => {
  mockedPermissions.mockRejectedValue(new Error("Health permission was denied."));

  await expect(connectHealthData()).resolves.toEqual({
    ok: false,
    message: "Health permission was denied.",
  });
  expect(mockedRead).not.toHaveBeenCalled();
  expect(mockedIntervalRead).not.toHaveBeenCalled();
});

test("preserves a measured zero while leaving missing metrics null", async () => {
  const result = await connectHealthData();

  expect(result.ok).toBe(true);
  expect(cacheWearableDays).toHaveBeenCalledWith([dailyRecord]);
  expect(enqueueWearableSync).toHaveBeenCalledWith({
    sync_id: "health-sync-uuid",
    records: [dailyRecord],
  });
  expect(cacheWearableIntervals).toHaveBeenCalledWith([intervalRecord]);
  expect(enqueueWearableIntervalSync).toHaveBeenCalledWith({
    sync_id: "health-sync-uuid",
    records: [intervalRecord],
  });
  expect(saveWearableState).toHaveBeenCalled();
  if (result.ok) {
    expect(result.value.metricsFound).toContain("steps");
    expect(result.value.metricsFound).not.toContain("sleep_minutes");
    expect(result.value.importedIntervals).toBe(1);
  }
});

test("serializes SQLite-backed health writes on the shared database connection", async () => {
  let releaseDailyCache: (() => void) | undefined;
  const dailyCacheBlocked = new Promise<void>((resolve) => {
    releaseDailyCache = resolve;
  });
  jest.mocked(cacheWearableDays).mockReturnValueOnce(dailyCacheBlocked);

  const connection = connectHealthData();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(cacheWearableDays).toHaveBeenCalledWith([dailyRecord]);
  expect(cacheWearableIntervals).not.toHaveBeenCalled();

  releaseDailyCache?.();
  await connection;

  expect(cacheWearableIntervals).toHaveBeenCalledWith([intervalRecord]);
});

test("rejects duplicate native interval buckets before queueing", async () => {
  mockedIntervalRead.mockResolvedValue([intervalRecord, intervalRecord]);

  await expect(connectHealthData()).resolves.toEqual({
    ok: false,
    message: "The health store returned a duplicate interval summary.",
  });
  expect(enqueueWearableIntervalSync).not.toHaveBeenCalled();
});

test("does not cache or upload the current incomplete six-hour bucket", async () => {
  const currentBucket = (Math.floor(new Date().getHours() / 6) * 6) as
    | 0
    | 6
    | 12
    | 18;
  mockedIntervalRead.mockResolvedValue([
    {
      ...intervalRecord,
      observed_date: localDateString(),
      bucket_start_hour: currentBucket,
    },
  ]);

  const result = await connectHealthData();

  expect(result.ok).toBe(true);
  expect(cacheWearableIntervals).toHaveBeenCalledWith([]);
  expect(enqueueWearableIntervalSync).not.toHaveBeenCalled();
  if (result.ok) expect(result.value.importedIntervals).toBe(0);
});

test("prefills measured sleep but never invents a zero", async () => {
  jest.mocked(cachedWearableDay).mockResolvedValue({
    ...dailyRecord,
    sleep_minutes: 425,
  });
  await expect(wearableSleepHoursForDate("2026-07-19")).resolves.toBe(7.1);

  jest.mocked(cachedWearableDay).mockResolvedValue(dailyRecord);
  await expect(wearableSleepHoursForDate("2026-07-19")).resolves.toBeNull();
});
