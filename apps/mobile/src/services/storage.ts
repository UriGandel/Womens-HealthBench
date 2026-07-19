import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";

import type {
  CheckInCreate,
  WearableDailyRecord,
  WearablePlatform,
  WearableSyncRequest,
} from "@/types";
import { checkInSchema, wearableDailyRecordSchema } from "@/validation";

const TOKEN_KEY = "whb.access-token";
const CONSENT_VERSION_KEY = "whb.consent-version";
const DATABASE_KEY = "whb.database-key.v1";
const DATABASE_NAME = "tomorrow-gently.db";

interface QueueRow {
  readonly client_submission_id: string;
  readonly payload: string;
}

interface WearableQueueRow {
  readonly sync_id: string;
  readonly payload: string;
}

interface WearableCacheRow {
  readonly payload: string;
}

export interface StoredWearableState {
  readonly platform: WearablePlatform;
  readonly last_read_at: string;
  readonly time_zone: string | null;
}

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function databaseKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DATABASE_KEY);
  if (existing) return existing;
  const created = bytesToHex(await Crypto.getRandomBytesAsync(32));
  await SecureStore.setItemAsync(DATABASE_KEY, created, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return created;
}

async function openEncryptedDatabase(): Promise<SQLite.SQLiteDatabase> {
  const key = await databaseKey();
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
  // Expo's SQLCipher integration requires PRAGMA key immediately after opening.
  // `key` is generated locally and contains only [0-9a-f], so it is safe to interpolate.
  await database.execAsync(`
    PRAGMA key = '${key}';
    PRAGMA cipher_memory_security = ON;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS checkin_queue (
      client_submission_id TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS wearable_sync_queue (
      sync_id TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS wearable_daily_cache (
      observed_date TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wearable_state (
      singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
      platform TEXT NOT NULL,
      last_read_at TEXT NOT NULL,
      time_zone TEXT
    );
  `);
  const wearableStateColumns = await database.getAllAsync<{ readonly name: string }>(
    "PRAGMA table_info(wearable_state)",
  );
  if (!wearableStateColumns.some((column) => column.name === "time_zone")) {
    await database.execAsync("ALTER TABLE wearable_state ADD COLUMN time_zone TEXT");
  }
  return database;
}

async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  databasePromise ??= openEncryptedDatabase();
  return databasePromise;
}

export async function initializeStorage(): Promise<void> {
  await getDatabase();
}

export function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export function saveAccessToken(token: string): Promise<void> {
  return SecureStore.setItemAsync(TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export function getStoredConsentVersion(): Promise<string | null> {
  return SecureStore.getItemAsync(CONSENT_VERSION_KEY);
}

export function saveStoredConsentVersion(version: string): Promise<void> {
  return SecureStore.setItemAsync(CONSENT_VERSION_KEY, version, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export function clearStoredConsentVersion(): Promise<void> {
  return SecureStore.deleteItemAsync(CONSENT_VERSION_KEY);
}

export async function clearAccessToken(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    clearStoredConsentVersion(),
  ]);
}

export async function enqueueCheckIn(payload: CheckInCreate): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT OR IGNORE INTO checkin_queue
      (client_submission_id, payload, created_at)
     VALUES (?, ?, ?)`,
    payload.client_submission_id,
    JSON.stringify(payload),
    new Date().toISOString(),
  );
}

export async function queuedCheckIns(): Promise<ReadonlyArray<CheckInCreate>> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<QueueRow>(
    "SELECT client_submission_id, payload FROM checkin_queue ORDER BY created_at ASC",
  );
  return rows.flatMap((row) => {
    try {
      const parsed = checkInSchema.safeParse(JSON.parse(row.payload) as unknown);
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });
}

export async function markCheckInSynced(clientSubmissionId: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    "DELETE FROM checkin_queue WHERE client_submission_id = ?",
    clientSubmissionId,
  );
}

export async function markCheckInFailed(
  clientSubmissionId: string,
  message: string,
): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE checkin_queue
     SET attempts = attempts + 1, last_error = ?
     WHERE client_submission_id = ?`,
    message.slice(0, 240),
    clientSubmissionId,
  );
}

export async function queueCount(): Promise<number> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ readonly count: number }>(
    "SELECT COUNT(*) AS count FROM checkin_queue",
  );
  return row?.count ?? 0;
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
  const database = await getDatabase();
  await database.withTransactionAsync(async () => {
    for (const record of records) {
      if (!hasWearableMetrics(record)) {
        await database.runAsync(
          "DELETE FROM wearable_daily_cache WHERE observed_date = ?",
          record.observed_date,
        );
        continue;
      }
      await database.runAsync(
        `INSERT INTO wearable_daily_cache (observed_date, payload, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(observed_date) DO UPDATE
         SET payload = excluded.payload, updated_at = excluded.updated_at`,
        record.observed_date,
        JSON.stringify(record),
        new Date().toISOString(),
      );
    }
  });
}

export async function cachedWearableDay(
  observedDate: string,
): Promise<WearableDailyRecord | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<WearableCacheRow>(
    "SELECT payload FROM wearable_daily_cache WHERE observed_date = ?",
    observedDate,
  );
  if (!row) return null;
  try {
    const parsed = wearableDailyRecordSchema.safeParse(
      JSON.parse(row.payload) as unknown,
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function enqueueWearableSync(
  payload: WearableSyncRequest,
): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT OR IGNORE INTO wearable_sync_queue (sync_id, payload, created_at)
     VALUES (?, ?, ?)`,
    payload.sync_id,
    JSON.stringify(payload),
    new Date().toISOString(),
  );
}

export async function queuedWearableSyncs(): Promise<
  ReadonlyArray<WearableSyncRequest>
> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<WearableQueueRow>(
    "SELECT sync_id, payload FROM wearable_sync_queue ORDER BY created_at ASC",
  );
  return rows.flatMap((row) => {
    try {
      const value = JSON.parse(row.payload) as unknown;
      if (
        typeof value !== "object" ||
        value === null ||
        !("sync_id" in value) ||
        !("records" in value) ||
        value.sync_id !== row.sync_id ||
        !Array.isArray(value.records)
      ) {
        return [];
      }
      const records = value.records.flatMap((record) => {
        const parsed = wearableDailyRecordSchema.safeParse(record);
        return parsed.success ? [parsed.data] : [];
      });
      if (records.length !== value.records.length || records.length < 1) return [];
      return [{ sync_id: row.sync_id, records }];
    } catch {
      return [];
    }
  });
}

export async function markWearableSyncComplete(syncId: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    "DELETE FROM wearable_sync_queue WHERE sync_id = ?",
    syncId,
  );
}

export async function markWearableSyncFailed(
  syncId: string,
  message: string,
): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE wearable_sync_queue
     SET attempts = attempts + 1, last_error = ?
     WHERE sync_id = ?`,
    message.slice(0, 240),
    syncId,
  );
}

export async function wearableQueueCount(): Promise<number> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ readonly count: number }>(
    "SELECT COUNT(*) AS count FROM wearable_sync_queue",
  );
  return row?.count ?? 0;
}

export async function saveWearableState(
  platform: WearablePlatform,
  lastReadAt: string,
  timeZone: string,
): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT INTO wearable_state (singleton, platform, last_read_at, time_zone)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(singleton) DO UPDATE
     SET platform = excluded.platform,
         last_read_at = excluded.last_read_at,
         time_zone = excluded.time_zone`,
    platform,
    lastReadAt,
    timeZone,
  );
}

export async function getWearableState(): Promise<StoredWearableState | null> {
  const database = await getDatabase();
  return database.getFirstAsync<StoredWearableState>(
    "SELECT platform, last_read_at, time_zone FROM wearable_state WHERE singleton = 1",
  );
}

export async function clearLocalWearableData(): Promise<void> {
  const database = await getDatabase();
  await database.execAsync(`
    DELETE FROM wearable_sync_queue;
    DELETE FROM wearable_daily_cache;
    DELETE FROM wearable_state;
  `);
}

export async function clearLocalHealthData(): Promise<void> {
  const database = await getDatabase();
  await database.execAsync(`
    DELETE FROM checkin_queue;
    DELETE FROM wearable_sync_queue;
    DELETE FROM wearable_daily_cache;
    DELETE FROM wearable_state;
  `);
}
