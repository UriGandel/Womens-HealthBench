import { beforeEach, expect, jest, test } from "@jest/globals";

import { sendWearableDays } from "@/services/api";
import {
  markWearableSyncComplete,
  markWearableSyncFailed,
  queuedWearableSyncs,
} from "@/services/storage";
import { syncQueuedWearables } from "@/services/sync";

jest.mock("@/services/api", () => ({
  sendCheckIn: jest.fn(),
  sendWearableDays: jest.fn(),
}));
jest.mock("@/services/storage", () => ({
  markCheckInFailed: jest.fn(),
  markCheckInSynced: jest.fn(),
  markWearableSyncComplete: jest.fn(),
  markWearableSyncFailed: jest.fn(),
  queuedCheckIns: jest.fn(),
  queuedWearableSyncs: jest.fn(),
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

beforeEach(() => {
  jest.clearAllMocks();
});

test("retains an offline wearable batch for retry", async () => {
  jest.mocked(queuedWearableSyncs)
    .mockResolvedValueOnce([batch])
    .mockResolvedValueOnce([batch]);
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
  jest.mocked(queuedWearableSyncs)
    .mockResolvedValueOnce([batch])
    .mockResolvedValueOnce([]);
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
