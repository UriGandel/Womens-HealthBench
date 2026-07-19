import { beforeEach, expect, test } from "@jest/globals";

import type { CheckInCreate, WearableDailyRecord } from "@/types";

import {
  cacheWearableDays,
  cacheCycleDays,
  cachedCycleDays,
  cachedWearableDay,
  clearAccessToken,
  clearLocalHealthData,
  cycleQueueCount,
  enqueueCycleSync,
  enqueueCheckIn,
  enqueueWearableSync,
  getAccessToken,
  getStoredConsentVersion,
  getCycleTrackingEnabled,
  getWearableState,
  queueCount,
  queuedCheckIns,
  queuedWearableSyncs,
  saveAccessToken,
  saveStoredConsentVersion,
  setCycleTrackingEnabled,
  saveWearableState,
  wearableQueueCount,
} from "./storage.web";

const CHECK_IN: CheckInCreate = {
  client_submission_id: "check-in-1",
  observed_date: "2026-07-19",
  period_status: "none",
  cycle_day: null,
  sleep_hours: 7,
  sleep_quality: 3,
  stress: 2,
  fatigue: 1,
  brain_fog: 0,
  headache: 0,
  pelvic_pain: 0,
  mood_disruption: 1,
};

const WEARABLE_DAY: WearableDailyRecord = {
  observed_date: "2026-07-19",
  platform: "apple_health",
  sleep_minutes: 420,
  steps: 7500,
  activity_minutes: null,
  active_energy_kcal: null,
  resting_heart_rate_bpm: null,
  hrv_ms: null,
  hrv_method: null,
  respiratory_rate_bpm: null,
  oxygen_saturation_pct: null,
  peripheral_temperature_delta_c: null,
};

beforeEach(async () => {
  await clearLocalHealthData();
  await clearAccessToken();
});

test("keeps the preview session and check-in queue in memory", async () => {
  await saveAccessToken("preview-token");
  await saveStoredConsentVersion("consent-v1");
  await enqueueCheckIn(CHECK_IN);

  expect(await getAccessToken()).toBe("preview-token");
  expect(await getStoredConsentVersion()).toBe("consent-v1");
  expect(await queueCount()).toBe(1);
  expect(await queuedCheckIns()).toEqual([CHECK_IN]);
});

test("supports the wearable storage contract without persistent browser data", async () => {
  await cacheWearableDays([WEARABLE_DAY]);
  await enqueueWearableSync({ sync_id: "wearable-1", records: [WEARABLE_DAY] });
  await saveWearableState("apple_health", "2026-07-19T12:00:00.000Z", "UTC");

  expect(await cachedWearableDay("2026-07-19")).toEqual(WEARABLE_DAY);
  expect(await wearableQueueCount()).toBe(1);
  expect(await queuedWearableSyncs()).toHaveLength(1);
  expect(await getWearableState()).toEqual({
    platform: "apple_health",
    last_read_at: "2026-07-19T12:00:00.000Z",
    time_zone: "UTC",
  });
});

test("supports volatile cycle state, edits, deletions, and queueing", async () => {
  await setCycleTrackingEnabled(true);
  await cacheCycleDays([
    { observed_date: "2026-07-18", period_status: "spotting" },
    { observed_date: "2026-07-19", period_status: "flow" },
  ]);
  await enqueueCycleSync({
    sync_id: "cycle-sync-1",
    local_today: "2026-07-19",
    records: [{ observed_date: "2026-07-19", period_status: "flow" }],
  });

  expect(await getCycleTrackingEnabled()).toBe(true);
  expect(await cachedCycleDays()).toHaveLength(2);
  expect(await cycleQueueCount()).toBe(1);

  await cacheCycleDays([
    { observed_date: "2026-07-18", period_status: null },
  ]);
  expect(await cachedCycleDays()).toEqual([
    { observed_date: "2026-07-19", period_status: "flow" },
  ]);

  await clearLocalHealthData();
  expect(await getCycleTrackingEnabled()).toBe(false);
  expect(await cachedCycleDays()).toEqual([]);
  expect(await cycleQueueCount()).toBe(0);
});
