import { StyleSheet, Text, View } from "react-native";

import { colors, type } from "@/theme";
import type { CheckInHistoryDay } from "@/types";
import { localDateString } from "@/utils/date";

// Sequential single-hue ramp (theme mineral, light → dark) for symptom load
// 0–4. Sequential data gets ONE hue with monotonic lightness — do not swap in
// multiple hues, status colors, or a red/green scale here.
const LOAD_RAMP = ["#D8E8E8", "#A8C0C3", "#78979E", "#476F78", "#174653"] as const;

const DAYS_SHOWN = 14;

// Load = mean of the five symptom ratings only (not sleep quality or stress,
// which are inputs to the forecast, not symptoms).
function symptomLoad(day: CheckInHistoryDay): number {
  const mean =
    (day.fatigue + day.brain_fog + day.headache + day.pelvic_pain + day.mood_disruption) / 5;
  return Math.min(4, Math.max(0, Math.round(mean)));
}

function shortDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

interface HistoryStripProps {
  readonly days: ReadonlyArray<CheckInHistoryDay>;
}

// Read-only 14-day strip for the "Your data" tab. Deliberately has no
// buttons or navigation — it is a glanceable mirror of logged days, and the
// tab should stay quiet. A day without a check-in renders as an outlined
// empty cell, NOT as load 0: missing data must never look like "no symptoms".
export function HistoryStrip({ days }: HistoryStripProps): React.ReactElement {
  const byDate = new Map(days.map((day) => [day.observed_date, day]));
  const today = new Date();
  const cells = Array.from({ length: DAYS_SHOWN }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (DAYS_SHOWN - 1 - index));
    const key = localDateString(date);
    return { key, label: shortDate(date), day: byDate.get(key) ?? null };
  });
  const oldestLabel = cells[0]?.label ?? "";
  const hasAny = cells.some((cell) => cell.day !== null);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {cells.map((cell) => {
          const load = cell.day ? symptomLoad(cell.day) : null;
          return (
            <View
              key={cell.key}
              accessibilityLabel={
                load === null
                  ? `${cell.label}: no check-in`
                  : `${cell.label}: symptom load ${load} of 4`
              }
              style={[
                styles.cell,
                load === null
                  ? styles.cellEmpty
                  : { backgroundColor: LOAD_RAMP[load] },
              ]}
            />
          );
        })}
      </View>
      <View style={styles.endLabels}>
        <Text style={styles.endLabel}>{oldestLabel}</Text>
        <Text style={styles.endLabel}>Today</Text>
      </View>
      <Text style={styles.hint}>
        {hasAny
          ? "Darker days carried more symptoms. Outlined days have no check-in."
          : "Your last 14 days will appear here as you check in."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  row: {
    flexDirection: "row",
    gap: 3,
  },
  cell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 6,
  },
  cellEmpty: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  endLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  endLabel: {
    color: colors.muted,
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 0.4,
  },
  hint: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 12,
    lineHeight: 18,
  },
});
