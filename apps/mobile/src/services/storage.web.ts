/**
 * Volatile browser-preview storage.
 *
 * The private alpha is a native application and uses SQLCipher in `storage.ts`.
 * This adapter exists only for visual inspection of the React Native Web build:
 * it deliberately persists neither access tokens nor health check-ins.
 */
import type { CheckInCreate } from "@/types";

let accessToken: string | null = null;
let queue: ReadonlyArray<CheckInCreate> = [];

export async function initializeStorage(): Promise<void> {
  // No persistent browser storage is opened for the native-only alpha.
}

export async function getAccessToken(): Promise<string | null> {
  return accessToken;
}

export async function saveAccessToken(token: string): Promise<void> {
  accessToken = token;
}

export async function clearAccessToken(): Promise<void> {
  accessToken = null;
}

export async function enqueueCheckIn(payload: CheckInCreate): Promise<void> {
  if (!queue.some((item) => item.client_submission_id === payload.client_submission_id)) {
    queue = [...queue, payload];
  }
}

export async function queuedCheckIns(): Promise<ReadonlyArray<CheckInCreate>> {
  return queue;
}

export async function markCheckInSynced(clientSubmissionId: string): Promise<void> {
  queue = queue.filter((item) => item.client_submission_id !== clientSubmissionId);
}

export async function markCheckInFailed(
  _clientSubmissionId: string,
  _message: string,
): Promise<void> {
  // Retry metadata is intentionally not persisted in the volatile preview.
}

export async function discardCheckIn(clientSubmissionId: string): Promise<void> {
  queue = queue.filter((item) => item.client_submission_id !== clientSubmissionId);
}

export async function queueCount(): Promise<number> {
  return queue.length;
}

export async function clearLocalHealthData(): Promise<void> {
  queue = [];
}

