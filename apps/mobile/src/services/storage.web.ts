/**
 * Volatile storage for the browser preview.
 *
 * This adapter intentionally uses module memory instead of browser persistence:
 * access tokens and health records disappear on refresh or when the tab closes.
 * Native builds continue to use encrypted SQLCipher and SecureStore storage.
 */
import type {
  CheckInCreate,
  CycleDayRecord,
  CycleSyncRequest,
  WearableDailyRecord,
  WearablePlatform,
  WearableSyncRequest,
} from "@/types";

export interface StoredWearableState {
  readonly platform: WearablePlatform;
  readonly last_read_at: string;
  readonly time_zone: string | null;
}

let accessToken: string | null = null;
let consentVersion: string | null = null;
let checkInQueue: ReadonlyArray<CheckInCreate> = [];
let wearableQueue: ReadonlyArray<WearableSyncRequest> = [];
let wearableDays: ReadonlyMap<string, WearableDailyRecord> = new Map();
let wearableState: StoredWearableState | null = null;
let cycleEnabled = false;
let cycleQueue: ReadonlyArray<CycleSyncRequest> = [];
let cycleDays: ReadonlyMap<string, CycleDayRecord> = new Map();

export async function initializeStorage(): Promise<void> {
  // Browser preview state is initialized by the module.
}

export async function getAccessToken(): Promise<string | null> {
  return accessToken;
}

export async function saveAccessToken(token: string): Promise<void> {
  accessToken = token;
}

export async function getStoredConsentVersion(): Promise<string | null> {
  return consentVersion;
}

export async function saveStoredConsentVersion(version: string): Promise<void> {
  consentVersion = version;
}

export async function clearStoredConsentVersion(): Promise<void> {
  consentVersion = null;
}

export async function clearAccessToken(): Promise<void> {
  accessToken = null;
  consentVersion = null;
}

export async function enqueueCheckIn(payload: CheckInCreate): Promise<void> {
  if (
    !checkInQueue.some(
      (item) => item.client_submission_id === payload.client_submission_id,
    )
  ) {
    checkInQueue = [...checkInQueue, payload];
  }
}

export async function queuedCheckIns(): Promise<ReadonlyArray<CheckInCreate>> {
  return checkInQueue;
}

export async function markCheckInSynced(
  clientSubmissionId: string,
): Promise<void> {
  checkInQueue = checkInQueue.filter(
    (item) => item.client_submission_id !== clientSubmissionId,
  );
}

export async function markCheckInFailed(
  _clientSubmissionId: string,
  _message: string,
): Promise<void> {
  // Retry metadata is not retained in the volatile preview.
}

export async function queueCount(): Promise<number> {
  return checkInQueue.length;
}

function hasWearableMetrics(record: WearableDailyRecord): boolean {
  return [
    record.sleep_minutes,
    record.steps,
    record.activity_minutes,
    record.active_energy_kcal,
    record.resting_heart_rate_bpm,
    record.hrv_ms,
    record.respiratory_rate_bpm,
    record.oxygen_saturation_pct,
    record.peripheral_temperature_delta_c,
  ].some((value) => value !== null);
}

export async function cacheWearableDays(
  records: ReadonlyArray<WearableDailyRecord>,
): Promise<void> {
  const updated = new Map(wearableDays);
  for (const record of records) {
    if (hasWearableMetrics(record)) {
      updated.set(record.observed_date, record);
    } else {
      updated.delete(record.observed_date);
    }
  }
  wearableDays = updated;
}

export async function cachedWearableDay(
  observedDate: string,
): Promise<WearableDailyRecord | null> {
  return wearableDays.get(observedDate) ?? null;
}

export async function enqueueWearableSync(
  payload: WearableSyncRequest,
): Promise<void> {
  if (!wearableQueue.some((item) => item.sync_id === payload.sync_id)) {
    wearableQueue = [...wearableQueue, payload];
  }
}

export async function queuedWearableSyncs(): Promise<
  ReadonlyArray<WearableSyncRequest>
> {
  return wearableQueue;
}

export async function markWearableSyncComplete(syncId: string): Promise<void> {
  wearableQueue = wearableQueue.filter((item) => item.sync_id !== syncId);
}

export async function markWearableSyncFailed(
  _syncId: string,
  _message: string,
): Promise<void> {
  // Retry metadata is not retained in the volatile preview.
}

export async function wearableQueueCount(): Promise<number> {
  return wearableQueue.length;
}

export async function setCycleTrackingEnabled(enabled: boolean): Promise<void> {
  cycleEnabled = enabled;
}

export async function getCycleTrackingEnabled(): Promise<boolean> {
  return cycleEnabled;
}

export async function cacheCycleDays(
  records: ReadonlyArray<CycleDayRecord>,
): Promise<void> {
  const updated = new Map(cycleDays);
  for (const record of records) {
    if (record.period_status === null) {
      updated.delete(record.observed_date);
    } else {
      updated.set(record.observed_date, record);
    }
  }
  cycleDays = updated;
}

export async function replaceCachedCycleDays(
  records: ReadonlyArray<CycleDayRecord>,
): Promise<void> {
  cycleDays = new Map(
    records.flatMap((record) =>
      record.period_status === null ? [] : [[record.observed_date, record] as const],
    ),
  );
}

export async function cachedCycleDays(): Promise<ReadonlyArray<CycleDayRecord>> {
  return [...cycleDays.values()].sort((a, b) =>
    a.observed_date.localeCompare(b.observed_date),
  );
}

export async function cachedCycleDay(
  observedDate: string,
): Promise<CycleDayRecord | null> {
  return cycleDays.get(observedDate) ?? null;
}

export async function enqueueCycleSync(payload: CycleSyncRequest): Promise<void> {
  if (!cycleQueue.some((item) => item.sync_id === payload.sync_id)) {
    cycleQueue = [...cycleQueue, payload];
  }
}

export async function queuedCycleSyncs(): Promise<ReadonlyArray<CycleSyncRequest>> {
  return cycleQueue;
}

export async function markCycleSyncComplete(syncId: string): Promise<void> {
  cycleQueue = cycleQueue.filter((item) => item.sync_id !== syncId);
}

export async function markCycleSyncFailed(
  _syncId: string,
  _message: string,
): Promise<void> {
  // Retry metadata is not retained in the volatile preview.
}

export async function cycleQueueCount(): Promise<number> {
  return cycleQueue.length;
}

export async function clearLocalCycleData(): Promise<void> {
  cycleEnabled = false;
  cycleQueue = [];
  cycleDays = new Map();
}

export async function saveWearableState(
  platform: WearablePlatform,
  lastReadAt: string,
  timeZone: string,
): Promise<void> {
  wearableState = {
    platform,
    last_read_at: lastReadAt,
    time_zone: timeZone,
  };
}

export async function getWearableState(): Promise<StoredWearableState | null> {
  return wearableState;
}

export async function clearLocalWearableData(): Promise<void> {
  wearableQueue = [];
  wearableDays = new Map();
  wearableState = null;
}

export async function clearLocalHealthData(): Promise<void> {
  checkInQueue = [];
  await clearLocalWearableData();
  await clearLocalCycleData();
}
