import { beforeEach, expect, jest, test } from "@jest/globals";

import {
  sendCycleDays,
  sendWearableDays,
  sendWearableIntervals,
} from "@/services/api";
import {
  markCycleSyncComplete,
  markCycleSyncFailed,
  markWearableSyncComplete,
  markWearableSyncFailed,
  markWearableIntervalSyncComplete,
  queuedWearableSyncs,
  queuedWearableIntervalSyncs,
  queuedCycleSyncs,
  wearableQueueCount,
} from "@/services/storage";
import { syncQueuedCycleDays, syncQueuedWearables } from "@/services/sync";

jest.mock("@/services/api", () => ({
  sendCheckIn: jest.fn(),
  sendCycleDays: jest.fn(),
  sendWearableDays: jest.fn(),
  sendWearableIntervals: jest.fn(),
}));
jest.mock("@/services/storage", () => ({
  markCycleSyncComplete: jest.fn(),
  markCycleSyncFailed: jest.fn(),
  markCheckInFailed: jest.fn(),
  markCheckInSynced: jest.fn(),
  markWearableSyncComplete: jest.fn(),
  markWearableSyncFailed: jest.fn(),
  markWearableIntervalSyncComplete: jest.fn(),
  markWearableIntervalSyncFailed: jest.fn(),
  queuedCheckIns: jest.fn(),
  queuedCycleSyncs: jest.fn(),
  queuedWearableSyncs: jest.fn(),
  queuedWearableIntervalSyncs: jest.fn(),
  wearableQueueCount: jest.fn(),
}));

const batch = {
  sync_id: "health-sync-uuid",
  records: [
    {
      observed_date: "2026-07-19",
      platform: "health_connect" as const,
      sleep_minutes: null,
      steps: 1200,
      activity_minutes: null,
      active_energy_kcal: null,
      resting_heart_rate_bpm: null,
      hrv_ms: null,
      hrv_method: null,
      respiratory_rate_bpm: null,
      oxygen_saturation_pct: null,
      peripheral_temperature_delta_c: null,
    },
  ],
};

const cycleBatch = {
  sync_id: "cycle-sync-uuid",
  local_today: "2026-07-19",
  records: [
    {
      observed_date: "2026-07-19",
      period_status: "flow" as const,
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(queuedWearableIntervalSyncs).mockResolvedValue([]);
});

test("retains an offline wearable batch for retry", async () => {
  jest.mocked(queuedWearableSyncs).mockResolvedValue([batch]);
  jest.mocked(wearableQueueCount).mockResolvedValue(1);
  jest.mocked(sendWearableDays).mockResolvedValue({
    ok: false,
    message: "Network unavailable",
  });

  await expect(syncQueuedWearables("token")).resolves.toEqual({
    synced: 0,
    remaining: 1,
  });
  expect(markWearableSyncFailed).toHaveBeenCalledWith(
    batch.sync_id,
    "Network unavailable",
  );
  expect(markWearableSyncComplete).not.toHaveBeenCalled();
});

test("removes a successfully uploaded wearable batch", async () => {
  jest.mocked(queuedWearableSyncs).mockResolvedValue([batch]);
  jest.mocked(wearableQueueCount).mockResolvedValue(0);
  jest.mocked(sendWearableDays).mockResolvedValue({
    ok: true,
    value: {
      accepted_days: 1,
      deleted_days: 0,
      duplicate: false,
      last_synced_at: "2026-07-19T12:00:00Z",
    },
  });

  await expect(syncQueuedWearables("token")).resolves.toEqual({
    synced: 1,
    remaining: 0,
  });
  expect(markWearableSyncComplete).toHaveBeenCalledWith(batch.sync_id);
});

test("uploads completed interval batches independently of daily summaries", async () => {
  const intervalBatch = {
    sync_id: "interval-sync-uuid",
    records: [
      {
        observed_date: "2026-07-18",
        bucket_start_hour: 18 as const,
        platform: "health_connect" as const,
        steps: 500,
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
    ],
  };
  jest.mocked(queuedWearableSyncs).mockResolvedValue([]);
  jest.mocked(queuedWearableIntervalSyncs).mockResolvedValue([intervalBatch]);
  jest.mocked(wearableQueueCount).mockResolvedValue(0);
  jest.mocked(sendWearableIntervals).mockResolvedValue({
    ok: true,
    value: {
      accepted_intervals: 1,
      deleted_intervals: 0,
      duplicate: false,
      last_synced_at: "2026-07-19T12:00:00Z",
    },
  });

  await expect(syncQueuedWearables("token")).resolves.toEqual({
    synced: 1,
    remaining: 0,
  });
  expect(markWearableIntervalSyncComplete).toHaveBeenCalledWith(
    intervalBatch.sync_id,
  );
});

test("retains an offline cycle edit without blocking other queues", async () => {
  jest.mocked(queuedCycleSyncs)
    .mockResolvedValueOnce([cycleBatch])
    .mockResolvedValueOnce([cycleBatch]);
  jest.mocked(sendCycleDays).mockResolvedValue({
    ok: false,
    message: "Network unavailable",
  });

  await expect(syncQueuedCycleDays("token")).resolves.toEqual({
    synced: 0,
    remaining: 1,
  });
  expect(markCycleSyncFailed).toHaveBeenCalledWith(
    cycleBatch.sync_id,
    "Network unavailable",
  );
  expect(markCycleSyncComplete).not.toHaveBeenCalled();
});

test("drops a permanently rejected cycle edit and reports it separately", async () => {
  jest.mocked(queuedCycleSyncs)
    .mockResolvedValueOnce([cycleBatch])
    .mockResolvedValueOnce([]);
  jest.mocked(sendCycleDays).mockResolvedValue({
    ok: false,
    message: "Cycle date cannot be in the future",
    status: 422,
  });

  await expect(syncQueuedCycleDays("token")).resolves.toEqual({
    synced: 0,
    remaining: 0,
    rejected: "A cycle-history edit was rejected: Cycle date cannot be in the future",
  });
  expect(markCycleSyncComplete).toHaveBeenCalledWith(cycleBatch.sync_id);
});
