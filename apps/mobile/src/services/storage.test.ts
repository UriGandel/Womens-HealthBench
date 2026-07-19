import { expect, jest, test } from "@jest/globals";

let releaseFirstWrite: (() => void) | undefined;
let signalFirstWrite: (() => void) | undefined;
let firstWrite = true;

const firstWriteStarted = new Promise<void>((resolve) => {
  signalFirstWrite = resolve;
});
const firstWriteBlocked = new Promise<void>((resolve) => {
  releaseFirstWrite = resolve;
});

const mockDatabase = {
  execAsync: jest.fn(async () => undefined),
  getAllAsync: jest.fn(async () => [{ name: "time_zone" }]),
  runAsync: jest.fn(async () => {
    if (!firstWrite) return;
    firstWrite = false;
    signalFirstWrite?.();
    await firstWriteBlocked;
  }),
  withTransactionAsync: jest.fn(async () => undefined),
};

jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked",
  getItemAsync: jest.fn(async () => "database-key"),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock("expo-crypto", () => ({
  getRandomBytesAsync: jest.fn(),
}));
jest.mock("expo-sqlite", () => ({
  openDatabaseAsync: jest.fn(async () => mockDatabase),
}));

import {
  cacheWearableDays,
  cacheWearableIntervals,
  clearLocalHealthData,
} from "@/services/storage";

test("serializes cache writes and deletion on the native SQLite connection", async () => {
  const dailyWrite = cacheWearableDays([
    {
      observed_date: "2026-07-19",
      platform: "apple_health",
      sleep_minutes: null,
      steps: 10,
      activity_minutes: null,
      active_energy_kcal: null,
      resting_heart_rate_bpm: null,
      hrv_ms: null,
      hrv_method: null,
      respiratory_rate_bpm: null,
      oxygen_saturation_pct: null,
      peripheral_temperature_delta_c: null,
    },
  ]);
  await firstWriteStarted;

  const intervalWrite = cacheWearableIntervals([
    {
      observed_date: "2026-07-19",
      bucket_start_hour: 0,
      platform: "apple_health",
      steps: 10,
      activity_minutes: null,
      active_energy_kcal: null,
      heart_rate_avg_bpm: null,
      heart_rate_min_bpm: null,
      heart_rate_max_bpm: null,
      heart_rate_sample_count: null,
      hrv_avg_ms: null,
      hrv_sample_count: null,
      hrv_method: null,
      respiratory_rate_avg_bpm: null,
      respiratory_rate_sample_count: null,
      oxygen_saturation_avg_pct: null,
      oxygen_saturation_sample_count: null,
    },
  ]);
  const clear = clearLocalHealthData();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(mockDatabase.runAsync).toHaveBeenCalledTimes(1);
  expect(mockDatabase.withTransactionAsync).not.toHaveBeenCalled();
  expect(mockDatabase.execAsync).toHaveBeenCalledTimes(1);

  releaseFirstWrite?.();
  await Promise.all([dailyWrite, intervalWrite, clear]);
  expect(mockDatabase.execAsync).toHaveBeenCalledTimes(2);
});

test("continues processing queued transactions after one write fails", async () => {
  mockDatabase.runAsync.mockRejectedValueOnce(new Error("write failed"));

  await expect(
    cacheWearableDays([
      {
        observed_date: "2026-07-20",
        platform: "apple_health",
        sleep_minutes: null,
        steps: 20,
        activity_minutes: null,
        active_energy_kcal: null,
        resting_heart_rate_bpm: null,
        hrv_ms: null,
        hrv_method: null,
        respiratory_rate_bpm: null,
        oxygen_saturation_pct: null,
        peripheral_temperature_delta_c: null,
      },
    ]),
  ).rejects.toThrow("write failed");

  await expect(
    cacheWearableIntervals([
      {
        observed_date: "2026-07-20",
        bucket_start_hour: 0,
        platform: "apple_health",
        steps: 20,
        activity_minutes: null,
        active_energy_kcal: null,
        heart_rate_avg_bpm: null,
        heart_rate_min_bpm: null,
        heart_rate_max_bpm: null,
        heart_rate_sample_count: null,
        hrv_avg_ms: null,
        hrv_sample_count: null,
        hrv_method: null,
        respiratory_rate_avg_bpm: null,
        respiratory_rate_sample_count: null,
        oxygen_saturation_avg_pct: null,
        oxygen_saturation_sample_count: null,
      },
    ]),
  ).resolves.toBeUndefined();
});
