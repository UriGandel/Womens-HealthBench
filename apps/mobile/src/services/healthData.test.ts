import { beforeEach, expect, jest, test } from "@jest/globals";

import {
  connectHealthData,
  getHealthAvailability,
  wearableSleepHoursForDate,
} from "@/services/healthData";
import {
  cacheWearableDays,
  cachedWearableDay,
  enqueueWearableSync,
  saveWearableState,
} from "@/services/storage";
import {
  getAvailability,
  readDailySummaries,
  requestPermissions,
} from "expo-health-data";

jest.mock("expo-health-data", () => ({
  getAvailability: jest.fn(),
  openHealthSettings: jest.fn(),
  readDailySummaries: jest.fn(),
  requestPermissions: jest.fn(),
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "health-sync-uuid" }));
jest.mock("@/services/storage", () => ({
  cacheWearableDays: jest.fn(),
  cachedWearableDay: jest.fn(),
  enqueueWearableSync: jest.fn(),
  getWearableState: jest.fn(),
  saveWearableState: jest.fn(),
}));

const mockedAvailability = jest.mocked(getAvailability);
const mockedRead = jest.mocked(readDailySummaries);
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
});

test("preserves a measured zero while leaving missing metrics null", async () => {
  const result = await connectHealthData();

  expect(result.ok).toBe(true);
  expect(cacheWearableDays).toHaveBeenCalledWith([dailyRecord]);
  expect(enqueueWearableSync).toHaveBeenCalledWith({
    sync_id: "health-sync-uuid",
    records: [dailyRecord],
  });
  expect(saveWearableState).toHaveBeenCalled();
  if (result.ok) {
    expect(result.value.metricsFound).toContain("steps");
    expect(result.value.metricsFound).not.toContain("sleep_minutes");
  }
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
