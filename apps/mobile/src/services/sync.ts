import { sendCheckIn } from "@/services/api";
import {
  markCheckInFailed,
  markCheckInSynced,
  queuedCheckIns,
} from "@/services/storage";

export interface SyncResult {
  readonly synced: number;
  readonly remaining: number;
  readonly rejected?: string;
}

let activeSync: Promise<SyncResult> | undefined;

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
    // Retry transport/server failures later; discard permanent validation or same-day conflicts.
    if (result.status !== undefined && result.status >= 400 && result.status < 500) {
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
