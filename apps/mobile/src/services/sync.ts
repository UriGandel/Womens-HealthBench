import { sendCheckIn, sendWearableDays } from "@/services/api";
import {
  markCheckInFailed,
  markCheckInSynced,
  markWearableSyncComplete,
  markWearableSyncFailed,
  queuedCheckIns,
  queuedWearableSyncs,
} from "@/services/storage";

export interface SyncResult {
  readonly synced: number;
  readonly remaining: number;
  readonly rejected?: string;
}

let activeSync: Promise<SyncResult> | undefined;
let activeWearableSync: Promise<SyncResult> | undefined;

async function runSync(token: string): Promise<SyncResult> {
  const queued = await queuedCheckIns();
  let synced = 0;
  let rejected: string | undefined;

  for (const checkIn of queued) {
    const result = await sendCheckIn(token, checkIn);
    if (result.ok) {
      await markCheckInSynced(checkIn.client_submission_id);
      synced += 1;
      continue;
    }

    await markCheckInFailed(checkIn.client_submission_id, result.message);
    // A consent precondition can be resolved, so keep that entry encrypted for a later sync.
    if (result.status === 428) {
      rejected = "Review the current participation consent before queued check-ins can sync.";
      break;
    }
    // Discard only permanent payload errors or same-day conflicts.
    if (result.status === 409 || result.status === 422) {
      await markCheckInSynced(checkIn.client_submission_id);
      rejected =
        result.status === 409
          ? "Today already has a check-in. The queued duplicate was not uploaded."
          : `A queued check-in was rejected: ${result.message}`;
      continue;
    }
    break;
  }

  const remaining = (await queuedCheckIns()).length;
  return rejected ? { synced, remaining, rejected } : { synced, remaining };
}

export function syncQueuedCheckIns(token: string): Promise<SyncResult> {
  activeSync ??= runSync(token).finally(() => {
    activeSync = undefined;
  });
  return activeSync;
}

async function runWearableSync(token: string): Promise<SyncResult> {
  const queued = await queuedWearableSyncs();
  let synced = 0;
  let rejected: string | undefined;

  for (const batch of queued) {
    const result = await sendWearableDays(token, batch);
    if (result.ok) {
      await markWearableSyncComplete(batch.sync_id);
      synced += 1;
      continue;
    }
    await markWearableSyncFailed(batch.sync_id, result.message);
    if (result.status === 428) {
      rejected = "Review the current participation consent before health data can sync.";
      break;
    }
    if (result.status === 409 || result.status === 422) {
      await markWearableSyncComplete(batch.sync_id);
      rejected = `A health-data batch was rejected: ${result.message}`;
      continue;
    }
    break;
  }

  const remaining = (await queuedWearableSyncs()).length;
  return rejected ? { synced, remaining, rejected } : { synced, remaining };
}

export function syncQueuedWearables(token: string): Promise<SyncResult> {
  activeWearableSync ??= runWearableSync(token).finally(() => {
    activeWearableSync = undefined;
  });
  return activeWearableSync;
}
