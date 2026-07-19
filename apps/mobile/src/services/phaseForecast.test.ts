import { afterEach, describe, expect, jest, test } from "@jest/globals";

import { getPhaseForecast } from "@/services/api";
import { phaseForecastResponseSchema } from "@/validation";

const readyResponse = {
  status: "ready",
  predicted_phase: "Follicular",
  model_version: "mcphases-app-common-0.2.0",
  usable_days: 7,
  required_days: 4,
  lookback_days: 7,
  disclaimer: "Research estimate only.",
} as const;

afterEach(() => {
  jest.restoreAllMocks();
});

describe("phase forecast response contract", () => {
  test("accepts the exact v0.2 response", () => {
    expect(phaseForecastResponseSchema.parse(readyResponse)).toEqual(readyResponse);
  });

  test("rejects probabilities and changed contract constants", () => {
    expect(
      phaseForecastResponseSchema.safeParse({
        ...readyResponse,
        probability: 0.7,
      }).success,
    ).toBe(false);
    expect(
      phaseForecastResponseSchema.safeParse({
        ...readyResponse,
        required_days: 3,
      }).success,
    ).toBe(false);
    expect(
      phaseForecastResponseSchema.safeParse({
        ...readyResponse,
        model_version: "mcphases-app-common-0.2.1",
      }).success,
    ).toBe(false);
  });

  test("requires a phase only when the model is ready", () => {
    expect(
      phaseForecastResponseSchema.safeParse({
        ...readyResponse,
        predicted_phase: null,
      }).success,
    ).toBe(false);
    expect(
      phaseForecastResponseSchema.safeParse({
        ...readyResponse,
        status: "insufficient_data",
      }).success,
    ).toBe(false);
    expect(
      phaseForecastResponseSchema.safeParse({
        ...readyResponse,
        status: "model_unavailable",
        predicted_phase: null,
        usable_days: 0,
      }).success,
    ).toBe(true);
  });
});

test("calls the separate authenticated phase endpoint", async () => {
  const fetchMock = jest
    .spyOn(global, "fetch")
    .mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => readyResponse,
    } as Response);

  const result = await getPhaseForecast("participant-token", "2026-07-19");

  expect(result).toEqual({ ok: true, value: readyResponse });
  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:8000/v1/research/phase-forecast?target_date=2026-07-19",
    expect.objectContaining({
      method: "GET",
      headers: expect.objectContaining({
        Authorization: "Bearer participant-token",
      }),
    }),
  );
});
