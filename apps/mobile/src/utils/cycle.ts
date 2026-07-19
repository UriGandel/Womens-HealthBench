import type {
  CycleDayRecord,
  CycleTrackingSummary,
  PeriodStatus,
} from "@/types";

function dateFromLocalString(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

function addDays(value: string, amount: number): string {
  const date = dateFromLocalString(value);
  date.setDate(date.getDate() + amount);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function cycleDayForDate(
  days: ReadonlyArray<CycleDayRecord>,
  observedDate: string,
): number | null {
  const flowDates = new Set(
    days
      .filter((day) => day.period_status === "flow")
      .map((day) => day.observed_date),
  );
  const starts = [...flowDates]
    .filter((date) => !flowDates.has(addDays(date, -1)))
    .filter((date) => date <= observedDate)
    .sort();
  const latest = starts.at(-1);
  if (!latest) return null;
  const milliseconds =
    dateFromLocalString(observedDate).getTime() - dateFromLocalString(latest).getTime();
  const candidate = Math.round(milliseconds / 86_400_000) + 1;
  return candidate >= 1 && candidate <= 120 ? candidate : null;
}

export function checkInCycleContext(
  days: ReadonlyArray<CycleDayRecord>,
  observedDate: string,
): { readonly period_status: PeriodStatus; readonly cycle_day: number | null } {
  const day = days.find((item) => item.observed_date === observedDate);
  return {
    period_status: day?.period_status ?? "none",
    cycle_day: cycleDayForDate(days, observedDate),
  };
}

export function applyCycleDay(
  summary: CycleTrackingSummary,
  record: CycleDayRecord,
  today: string,
): CycleTrackingSummary {
  const byDate = new Map(summary.days.map((day) => [day.observed_date, day]));
  if (record.period_status === null) {
    byDate.delete(record.observed_date);
  } else {
    byDate.set(record.observed_date, record);
  }
  const days = [...byDate.values()].sort((a, b) =>
    a.observed_date.localeCompare(b.observed_date),
  );
  const currentCycleDay = cycleDayForDate(days, today);
  const cycleStartedOn =
    currentCycleDay === null ? null : addDays(today, -(currentCycleDay - 1));
  const flowDates = new Set(
    days
      .filter((day) => day.period_status === "flow")
      .map((day) => day.observed_date),
  );
  const starts = [...flowDates]
    .filter((date) => !flowDates.has(addDays(date, -1)))
    .sort();
  const lengths = starts
    .slice(1)
    .map(
      (start, index) =>
        Math.round(
          (dateFromLocalString(start).getTime() -
            dateFromLocalString(starts[index] ?? start).getTime()) /
            86_400_000,
        ),
    )
    .filter((length) => length >= 1 && length <= 120)
    .sort((a, b) => a - b);
  const middle = Math.floor(lengths.length / 2);
  const observedLength =
    lengths.length < 2
      ? null
      : lengths.length % 2 === 1
        ? lengths[middle] ?? null
        : ((lengths[middle - 1] ?? 0) + (lengths[middle] ?? 0)) / 2;
  return {
    ...summary,
    days,
    current_cycle_day: currentCycleDay,
    cycle_started_on: cycleStartedOn,
    observed_cycle_length_days: observedLength,
    cycle_start_count: starts.length,
    pattern_status: "insufficient_data",
    patterns: [],
  };
}

export function localCycleSummary(
  enabled: boolean,
  days: ReadonlyArray<CycleDayRecord>,
  today: string,
): CycleTrackingSummary {
  const currentCycleDay = enabled ? cycleDayForDate(days, today) : null;
  return {
    enabled,
    days: enabled ? days : [],
    current_cycle_day: currentCycleDay,
    cycle_started_on:
      currentCycleDay === null ? null : addDays(today, -(currentCycleDay - 1)),
    observed_cycle_length_days: null,
    cycle_start_count: 0,
    pattern_status: "insufficient_data",
    patterns: [],
  };
}
