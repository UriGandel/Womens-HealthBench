import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Screen } from "@/components/Screen";
import { useApp } from "@/providers/AppProvider";
import { colors, radius, type } from "@/theme";
import type { CycleStatus } from "@/types";
import { cycleDayForDate } from "@/utils/cycle";
import { localDateString } from "@/utils/date";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const STATUS_OPTIONS: ReadonlyArray<{
  readonly value: CycleStatus | null;
  readonly label: string;
}> = [
  { value: null, label: "None" },
  { value: "spotting", label: "Spotting" },
  { value: "flow", label: "Flow" },
];

function localDate(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

function shiftDays(date: Date, amount: number): Date {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + amount);
  return shifted;
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

function shiftMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1, 12);
}

function sameMonth(first: Date, second: Date): boolean {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth()
  );
}

function monthCells(month: Date): ReadonlyArray<Date | null> {
  const startOffset = month.getDay();
  const count = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate();
  const cells: Array<Date | null> = Array.from({ length: startOffset }, () => null);
  for (let day = 1; day <= count; day += 1) {
    cells.push(new Date(month.getFullYear(), month.getMonth(), day, 12));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(localDate(value));
}

export default function CycleScreen(): React.ReactElement {
  const {
    cycleSummary,
    cyclePendingCount,
    cycleSyncIssue,
    isOnline,
    enableCycleTracking,
    logCycleDay,
  } = useApp();
  const todayString = localDateString();
  const today = localDate(todayString);
  const earliest = shiftDays(today, -119);
  const earliestString = localDateString(earliest);
  const [visibleMonth, setVisibleMonth] = useState(monthStart(today));
  const [selectedDate, setSelectedDate] = useState(todayString);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const daysByDate = useMemo(
    () =>
      new Map(
        (cycleSummary?.days ?? []).map((day) => [
          day.observed_date,
          day.period_status,
        ]),
      ),
    [cycleSummary?.days],
  );
  const cells = useMemo(() => monthCells(visibleMonth), [visibleMonth]);
  const selectedStatus = daysByDate.get(selectedDate) ?? null;
  const selectedCycleDay = cycleDayForDate(cycleSummary?.days ?? [], selectedDate);
  const canGoBack = !sameMonth(visibleMonth, monthStart(earliest));
  const canGoForward = !sameMonth(visibleMonth, monthStart(today));

  const enable = async (): Promise<void> => {
    setSaving(true);
    setMessage(null);
    const result = await enableCycleTracking();
    if (!result.ok) setMessage(result.message);
    setSaving(false);
  };

  const setStatus = async (status: CycleStatus | null): Promise<void> => {
    setSaving(true);
    setMessage(null);
    const result = await logCycleDay(selectedDate, status);
    if (!result.ok) setMessage(result.message);
    setSaving(false);
  };

  if (!cycleSummary?.enabled) {
    return (
      <Screen>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="calendar-outline" size={25} color={colors.plum} />
          </View>
          <Text style={styles.eyebrow}>OPTIONAL CYCLE HISTORY</Text>
          <Text style={styles.title}>Notice patterns, gently.</Text>
          <Text style={styles.subtitle}>
            Log spotting or flow and compare it with your symptom check-ins. Cycle
            history is sensitive operational data and is not added to research
            unless it appears in a completed check-in.
          </Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>What this does</Text>
          <Text style={styles.detail}>
            Calculates cycle day after a logged flow start, keeps 120 days of
            editable history, and shows personal associations once enough records
            are available.
          </Text>
          <View style={styles.rule} />
          <Text style={styles.sectionTitle}>What this does not do</Text>
          <Text style={styles.detail}>
            It does not estimate fertility, ovulation, future phases, or your next
            period. It is not medical advice.
          </Text>
        </View>
        {!isOnline ? (
          <Notice
            tone="warning"
            text="A secure connection is required to enable cycle tracking."
          />
        ) : null}
        {message ? <Notice tone="warning" text={message} /> : null}
        <Button
          label="Enable cycle tracking"
          disabled={!isOnline}
          loading={saving}
          onPress={() => void enable()}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>YOUR CYCLE</Text>
        <Text style={styles.title}>
          {cycleSummary.current_cycle_day === null
            ? "Not enough history yet"
            : `Cycle day ${cycleSummary.current_cycle_day}`}
        </Text>
        <Text style={styles.subtitle}>
          {cycleSummary.current_cycle_day === null
            ? "Log a flow start to begin automatic cycle-day counting."
            : "Calculated from your latest logged flow start."}
        </Text>
      </View>

      {!isOnline ? (
        <Notice text="You’re offline. Cycle edits will stay encrypted on this device and sync later." />
      ) : null}
      {cyclePendingCount > 0 ? (
        <Notice
          text={`${cyclePendingCount} cycle ${cyclePendingCount === 1 ? "edit is" : "edits are"} waiting to sync.`}
        />
      ) : null}
      {cycleSyncIssue ? <Notice tone="warning" text={cycleSyncIssue} /> : null}
      {message ? <Notice tone="warning" text={message} /> : null}

      <View style={styles.calendarCard}>
        <View style={styles.monthHeader}>
          <Pressable
            accessibilityLabel="Previous month"
            accessibilityRole="button"
            disabled={!canGoBack}
            onPress={() => setVisibleMonth((current) => shiftMonths(current, -1))}
            style={[styles.monthButton, !canGoBack && styles.disabled]}
          >
            <Ionicons name="chevron-back" size={20} color={colors.ink} />
          </Pressable>
          <Text style={styles.monthTitle}>
            {new Intl.DateTimeFormat(undefined, {
              month: "long",
              year: "numeric",
            }).format(visibleMonth)}
          </Text>
          <Pressable
            accessibilityLabel="Next month"
            accessibilityRole="button"
            disabled={!canGoForward}
            onPress={() => setVisibleMonth((current) => shiftMonths(current, 1))}
            style={[styles.monthButton, !canGoForward && styles.disabled]}
          >
            <Ionicons name="chevron-forward" size={20} color={colors.ink} />
          </Pressable>
        </View>
        <View style={styles.weekRow}>
          {WEEKDAYS.map((weekday, index) => (
            <Text key={`${weekday}-${index}`} style={styles.weekday}>
              {weekday}
            </Text>
          ))}
        </View>
        <View style={styles.grid}>
          {cells.map((date, index) => {
            if (!date) return <View key={`blank-${index}`} style={styles.dayCell} />;
            const value = localDateString(date);
            const status = daysByDate.get(value);
            const selectable = value >= earliestString && value <= todayString;
            const selected = value === selectedDate;
            return (
              <Pressable
                key={value}
                accessibilityLabel={`${displayDate(value)}${status ? `, ${status}` : ""}`}
                accessibilityRole="button"
                accessibilityState={{ disabled: !selectable, selected }}
                disabled={!selectable}
                onPress={() => setSelectedDate(value)}
                style={[styles.dayCell, !selectable && styles.disabled]}
              >
                <View style={[styles.daySurface, selected && styles.daySelected]}>
                  <Text style={[styles.dayNumber, selected && styles.dayNumberSelected]}>
                    {date.getDate()}
                  </Text>
                  {status ? (
                    <View
                      style={[
                        styles.dayMark,
                        styles.calendarMark,
                        status === "spotting" ? styles.spottingMark : styles.flowMark,
                      ]}
                    />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.legend}>
          <View style={[styles.dayMark, styles.spottingMark]} />
          <Text style={styles.legendText}>Spotting</Text>
          <View style={[styles.dayMark, styles.flowMark]} />
          <Text style={styles.legendText}>Flow</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{displayDate(selectedDate)}</Text>
        <Text style={styles.detail}>
          {selectedCycleDay === null
            ? "Cycle day will appear after a flow start is logged."
            : `Automatically calculated as cycle day ${selectedCycleDay}.`}
        </Text>
        <View style={styles.segmented}>
          {STATUS_OPTIONS.map((option) => (
            <Pressable
              key={option.label}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedStatus === option.value }}
              disabled={saving}
              onPress={() => void setStatus(option.value)}
              style={[
                styles.segment,
                selectedStatus === option.value && styles.segmentSelected,
              ]}
            >
              <Text
                style={[
                  styles.segmentLabel,
                  selectedStatus === option.value && styles.segmentLabelSelected,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Your patterns</Text>
        {cycleSummary.observed_cycle_length_days !== null ? (
          <View style={styles.patternRow}>
            <Text style={styles.patternValue}>
              {cycleSummary.observed_cycle_length_days}
            </Text>
            <Text style={styles.patternCopy}>
              Median days between your observed flow starts.
            </Text>
          </View>
        ) : null}
        {cycleSummary.patterns.map((pattern) => (
          <View key={pattern.label} style={styles.patternItem}>
            <View style={styles.patternIcon}>
              <Ionicons
                name={pattern.direction === "higher" ? "arrow-up" : "arrow-down"}
                size={15}
                color={colors.plum}
              />
            </View>
            <View style={styles.patternText}>
              <Text style={styles.patternTitle}>{pattern.label}</Text>
              <Text style={styles.detail}>{pattern.detail}</Text>
            </View>
          </View>
        ))}
        {cycleSummary.pattern_status === "insufficient_data" ? (
          <Text style={styles.detail}>
            Patterns appear after three flow starts and at least three check-ins
            on bleeding days and three on other days.
          </Text>
        ) : cycleSummary.patterns.length === 0 ? (
          <Text style={styles.detail}>
            There is enough history, but no symptom difference met the display
            threshold. That is a valid result.
          </Text>
        ) : null}
        <Text style={styles.finePrint}>
          These are associations in your own records, not causes or medical conclusions.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.amberSoft,
    borderRadius: 36,
    padding: 24,
    gap: 12,
    borderWidth: 1,
    borderColor: "#E9D29F",
  },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  header: { gap: 8, paddingTop: 8 },
  eyebrow: {
    color: colors.mineral,
    fontFamily: type.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.1,
  },
  title: {
    color: colors.ink,
    fontFamily: type.display,
    fontSize: 36,
    lineHeight: 42,
    letterSpacing: -0.7,
  },
  subtitle: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 14,
    lineHeight: 22,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
    gap: 14,
  },
  calendarCard: {
    backgroundColor: colors.white,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 9,
  },
  sectionTitle: {
    color: colors.ink,
    fontFamily: type.display,
    fontSize: 21,
  },
  detail: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 12,
    lineHeight: 19,
  },
  finePrint: {
    color: colors.muted,
    fontFamily: type.body,
    fontSize: 11,
    lineHeight: 17,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 12,
  },
  rule: { height: 1, backgroundColor: colors.line },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  monthButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paper,
  },
  monthTitle: {
    color: colors.ink,
    fontFamily: type.display,
    fontSize: 18,
  },
  weekRow: { flexDirection: "row", marginTop: 2 },
  weekday: {
    width: `${100 / 7}%`,
    textAlign: "center",
    color: colors.muted,
    fontFamily: type.mono,
    fontSize: 9,
  },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: {
    width: `${100 / 7}%`,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  daySurface: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  daySelected: { backgroundColor: colors.mineralDark },
  dayNumber: {
    color: colors.ink,
    fontFamily: type.body,
    fontSize: 13,
    lineHeight: 18,
  },
  dayNumberSelected: { color: colors.white, fontWeight: "700" },
  dayMark: { width: 6, height: 6, borderRadius: 3 },
  calendarMark: { position: "absolute", bottom: 3 },
  spottingMark: { backgroundColor: colors.amber },
  flowMark: { backgroundColor: colors.plum },
  disabled: { opacity: 0.28 },
  legend: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingTop: 5,
    paddingBottom: 1,
  },
  legendText: {
    color: colors.muted,
    fontFamily: type.body,
    fontSize: 10,
    marginRight: 7,
  },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.paper,
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentSelected: { backgroundColor: colors.mineralDark },
  segmentLabel: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 12,
    fontWeight: "700",
  },
  segmentLabelSelected: { color: colors.white },
  patternRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.paper,
    borderRadius: radius.medium,
    padding: 14,
  },
  patternValue: {
    color: colors.plum,
    fontFamily: type.display,
    fontSize: 30,
  },
  patternCopy: {
    flex: 1,
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 12,
    lineHeight: 18,
  },
  patternItem: { flexDirection: "row", gap: 11, alignItems: "flex-start" },
  patternIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.amberSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  patternText: { flex: 1, gap: 3 },
  patternTitle: {
    color: colors.ink,
    fontFamily: type.body,
    fontSize: 14,
    fontWeight: "700",
  },
});
