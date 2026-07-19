import { expect, test } from "@jest/globals";

import { applyCycleDay, checkInCycleContext, cycleDayForDate } from "@/utils/cycle";

const days = [
  { observed_date: "2026-06-20", period_status: "spotting" as const },
  { observed_date: "2026-06-21", period_status: "flow" as const },
  { observed_date: "2026-06-22", period_status: "flow" as const },
];

test("starts cycle day one on flow after a non-flow day", () => {
  expect(cycleDayForDate(days, "2026-06-20")).toBeNull();
  expect(cycleDayForDate(days, "2026-06-21")).toBe(1);
  expect(cycleDayForDate(days, "2026-06-28")).toBe(8);
});

test("returns no cycle day beyond the 120-day boundary", () => {
  expect(cycleDayForDate(days, "2026-10-19")).toBeNull();
});

test("prefills check-in context and recomputes after an edit", () => {
  expect(checkInCycleContext(days, "2026-06-22")).toEqual({
    period_status: "flow",
    cycle_day: 2,
  });
  const summary = {
    enabled: true,
    days,
    current_cycle_day: 2,
    cycle_started_on: "2026-06-21",
    observed_cycle_length_days: null,
    cycle_start_count: 1,
    pattern_status: "ready" as const,
    patterns: [
      {
        label: "Fatigue",
        direction: "higher" as const,
        detail: "Previously calculated",
      },
    ],
    prediction_status: "ready" as const,
    prediction_confidence: "high" as const,
    projected_through: "2026-08-31",
    predicted_period_windows: [],
    phase_days: [],
  };
  const updated = applyCycleDay(
    summary,
    { observed_date: "2026-06-21", period_status: null },
    "2026-06-22",
  );
  expect(updated.current_cycle_day).toBe(1);
  expect(updated.cycle_started_on).toBe("2026-06-22");
  expect(updated.pattern_status).toBe("insufficient_data");
  expect(updated.patterns).toEqual([]);
});
