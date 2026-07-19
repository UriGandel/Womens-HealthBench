import {
  sendCheckIn,
  sendCycleDays,
  sendWearableDays,
  sendWearableIntervals,
} from "@/services/api";
import {
  markCycleSyncComplete,
  markCycleSyncFailed,
  markCheckInFailed,
  markCheckInSynced,
  markWearableSyncComplete,
  markWearableSyncFailed,
  markWearableIntervalSyncComplete,
  markWearableIntervalSyncFailed,
  queuedCheckIns,
  queuedCycleSyncs,
  queuedWearableSyncs,
  queuedWearableIntervalSyncs,
  wearableQueueCount,
} from "@/services/storage";

export interface SyncResult {
  readonly synced: number;
  readonly remaining: number;
  readonly rejected?: string;
}

let activeSync: Promise<SyncResult> | undefined;
let activeWearableSync: Promise<SyncResult> | undefined;
let activeCycleSync: Promise<SyncResult> | undefined;

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
  const queuedIntervals = await queuedWearableIntervalSyncs();
  let synced = 0;
  let rejected: string | undefined;
  let haltIntervalSync = false;

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
      haltIntervalSync = true;
      break;
    }
    if (result.status === 409 || result.status === 422) {
      await markWearableSyncComplete(batch.sync_id);
      rejected = `A health-data batch was rejected: ${result.message}`;
      continue;
    }
    haltIntervalSync = true;
    break;
  }

  if (!haltIntervalSync) {
    for (const batch of queuedIntervals) {
      const result = await sendWearableIntervals(token, batch);
      if (result.ok) {
        await markWearableIntervalSyncComplete(batch.sync_id);
        synced += 1;
        continue;
      }
      await markWearableIntervalSyncFailed(batch.sync_id, result.message);
      if (result.status === 428) {
        rejected =
          "Review the current participation consent before health data can sync.";
        break;
      }
      if (result.status === 409 || result.status === 422) {
        await markWearableIntervalSyncComplete(batch.sync_id);
        rejected = `A health-data interval batch was rejected: ${result.message}`;
        continue;
      }
      break;
    }
  }

  const remaining = await wearableQueueCount();
  return rejected ? { synced, remaining, rejected } : { synced, remaining };
}

export function syncQueuedWearables(token: string): Promise<SyncResult> {
  activeWearableSync ??= runWearableSync(token).finally(() => {
    activeWearableSync = undefined;
  });
  return activeWearableSync;
}

async function runCycleSync(token: string): Promise<SyncResult> {
  const queued = await queuedCycleSyncs();
  let synced = 0;
  let rejected: string | undefined;

  for (const batch of queued) {
    const result = await sendCycleDays(token, batch);
    if (result.ok) {
      await markCycleSyncComplete(batch.sync_id);
      synced += 1;
      continue;
    }
    await markCycleSyncFailed(batch.sync_id, result.message);
    if (result.status === 428) {
      rejected = "Review the current participation consent before cycle history can sync.";
      break;
    }
    if (result.status === 409 || result.status === 422) {
      await markCycleSyncComplete(batch.sync_id);
      rejected = `A cycle-history edit was rejected: ${result.message}`;
      continue;
    }
    break;
  }

  const remaining = (await queuedCycleSyncs()).length;
  return rejected ? { synced, remaining, rejected } : { synced, remaining };
}

export function syncQueuedCycleDays(token: string): Promise<SyncResult> {
  activeCycleSync ??= runCycleSync(token).finally(() => {
    activeCycleSync = undefined;
  });
  return activeCycleSync;
}
