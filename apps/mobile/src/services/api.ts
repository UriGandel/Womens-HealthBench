import type {
  AccountSummary,
  CheckInCreate,
  ConsentResponse,
  CycleDeleteResponse,
  CycleSyncRequest,
  CycleSyncResponse,
  CycleTrackingSummary,
  EnrollRequest,
  EnrollResponse,
  ForecastResponse,
  Result,
  WearableDeleteResponse,
  WearableIntervalSyncRequest,
  WearableIntervalSyncResponse,
  WearableSyncRequest,
  WearableSyncResponse,
} from "@/types";
import {
  accountSummarySchema,
  consentResponseSchema,
  cycleDeleteResponseSchema,
  cycleSyncResponseSchema,
  cycleTrackingSummarySchema,
  enrollResponseSchema,
  forecastResponseSchema,
  messageResponseSchema,
  wearableDeleteResponseSchema,
  wearableIntervalSyncResponseSchema,
  wearableSyncResponseSchema,
} from "@/validation";
import type { ZodType } from "zod";
import { z } from "zod";

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.detail === "string") {
      return body.detail;
    }
  } catch {
    // A non-JSON upstream error is represented by the status below.
  }
  return `The server returned ${response.status}.`;
}

async function request<T>(
  path: string,
  options: Readonly<RequestInit>,
  schema: ZodType<T>,
  token?: string,
): Promise<Result<T>> {
  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    if (!response.ok) {
      return { ok: false, message: await readError(response), status: response.status };
    }
    const body: unknown = await response.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return { ok: false, message: "The server response was not in the expected format." };
    }
    return { ok: true, value: parsed.data };
  } catch {
    return {
      ok: false,
      message: "No connection. Your entry is safe on this device and will sync later.",
    };
  }
}

export function enroll(payload: EnrollRequest): Promise<Result<EnrollResponse>> {
  return request<EnrollResponse>("/v1/enroll", {
    method: "POST",
    body: JSON.stringify(payload),
  }, enrollResponseSchema);
}

export function sendCheckIn(
  token: string,
  payload: CheckInCreate,
): Promise<Result<unknown>> {
  return request<unknown>(
    "/v1/check-ins",
    { method: "POST", body: JSON.stringify(payload) },
    // The mobile client only needs a valid JSON response to acknowledge the queued row.
    z.unknown(),
    token,
  );
}

export function getForecast(token: string): Promise<Result<ForecastResponse>> {
  return request<ForecastResponse>(
    "/v1/forecast",
    { method: "GET" },
    forecastResponseSchema,
    token,
  );
}

export function getAccount(token: string): Promise<Result<AccountSummary>> {
  return request<AccountSummary>("/v1/account", { method: "GET" }, accountSummarySchema, token);
}

export function enableCycleTracking(
  token: string,
  localToday: string,
): Promise<Result<CycleTrackingSummary>> {
  return request<CycleTrackingSummary>(
    "/v1/cycle-tracking",
    {
      method: "PUT",
      body: JSON.stringify({
        acknowledged_sensitive_data: true,
        local_today: localToday,
      }),
    },
    cycleTrackingSummarySchema,
    token,
  );
}

export function getCycleTracking(
  token: string,
  localToday: string,
): Promise<Result<CycleTrackingSummary>> {
  return request<CycleTrackingSummary>(
    `/v1/cycle-tracking?local_today=${encodeURIComponent(localToday)}`,
    { method: "GET" },
    cycleTrackingSummarySchema,
    token,
  );
}

export function sendCycleDays(
  token: string,
  payload: CycleSyncRequest,
): Promise<Result<CycleSyncResponse>> {
  return request<CycleSyncResponse>(
    "/v1/cycle-days:sync",
    { method: "POST", body: JSON.stringify(payload) },
    cycleSyncResponseSchema,
    token,
  );
}

export function deleteCycleTracking(
  token: string,
): Promise<Result<CycleDeleteResponse>> {
  return request<CycleDeleteResponse>(
    "/v1/cycle-tracking",
    { method: "DELETE" },
    cycleDeleteResponseSchema,
    token,
  );
}

export function acceptConsent(
  token: string,
  consentVersion: string,
): Promise<Result<ConsentResponse>> {
  return request<ConsentResponse>(
    "/v1/consent",
    {
      method: "PUT",
      body: JSON.stringify({
        operational_consent: true,
        research_consent: true,
        consent_version: consentVersion,
      }),
    },
    consentResponseSchema,
    token,
  );
}

export function sendWearableDays(
  token: string,
  payload: WearableSyncRequest,
): Promise<Result<WearableSyncResponse>> {
  return request<WearableSyncResponse>(
    "/v1/wearable-days:sync",
    { method: "POST", body: JSON.stringify(payload) },
    wearableSyncResponseSchema,
    token,
  );
}

export function sendWearableIntervals(
  token: string,
  payload: WearableIntervalSyncRequest,
): Promise<Result<WearableIntervalSyncResponse>> {
  return request<WearableIntervalSyncResponse>(
    "/v1/wearable-intervals:sync",
    { method: "POST", body: JSON.stringify(payload) },
    wearableIntervalSyncResponseSchema,
    token,
  );
}

export function deleteWearableData(
  token: string,
): Promise<Result<WearableDeleteResponse>> {
  return request<WearableDeleteResponse>(
    "/v1/wearable-data",
    { method: "DELETE" },
    wearableDeleteResponseSchema,
    token,
  );
}

export function deleteAccount(token: string): Promise<Result<{ readonly message: string }>> {
  return request<{ readonly message: string }>(
    "/v1/account",
    { method: "DELETE" },
    messageResponseSchema,
    token,
  );
}
