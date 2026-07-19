import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";

import type { CheckInCreate } from "@/types";
import { checkInSchema } from "@/validation";

const TOKEN_KEY = "whb.access-token";
const DATABASE_KEY = "whb.database-key.v1";
const DATABASE_NAME = "tomorrow-gently.db";

interface QueueRow {
  readonly client_submission_id: string;
  readonly payload: string;
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
  `);
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

export function clearAccessToken(): Promise<void> {
  return SecureStore.deleteItemAsync(TOKEN_KEY);
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

export async function clearLocalHealthData(): Promise<void> {
  const database = await getDatabase();
  await database.runAsync("DELETE FROM checkin_queue");
}
