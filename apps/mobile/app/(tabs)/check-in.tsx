import * as Crypto from "expo-crypto";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { RatingScale } from "@/components/RatingScale";
import { Screen } from "@/components/Screen";
import { useApp } from "@/providers/AppProvider";
import { colors, radius, type } from "@/theme";
import type { PeriodStatus, Rating } from "@/types";
import { localDateString, shortTodayLabel } from "@/utils/date";

const PERIOD_OPTIONS: ReadonlyArray<{
  readonly value: PeriodStatus;
  readonly label: string;
}> = [
  { value: "none", label: "None" },
  { value: "spotting", label: "Spotting" },
  { value: "flow", label: "Flow" },
];

interface Ratings {
  readonly sleepQuality: Rating | null;
  readonly stress: Rating | null;
  readonly fatigue: Rating | null;
  readonly brainFog: Rating | null;
  readonly headache: Rating | null;
  readonly pelvicPain: Rating | null;
  readonly moodDisruption: Rating | null;
}

// Ratings start unselected so saved values are observations, not defaults.
const INITIAL_RATINGS: Ratings = {
  sleepQuality: null,
  stress: null,
  fatigue: null,
  brainFog: null,
  headache: null,
  pelvicPain: null,
  moodDisruption: null,
};

export default function CheckInScreen(): React.ReactElement {
  const {
    submitCheckIn,
    isOnline,
    pendingCount,
    syncIssue,
    wearableSleepHours,
    cycleSummary,
    cycleContextForDate,
    logCycleDay,
  } = useApp();
  const router = useRouter();
  const [periodStatus, setPeriodStatus] = useState<PeriodStatus | null>(null);
  const [cycleDay, setCycleDay] = useState<number | null>(null);
  const [sleepHours, setSleepHours] = useState("");
  const [sleepPrefilled, setSleepPrefilled] = useState(false);
  const [ratings, setRatings] = useState<Ratings>(INITIAL_RATINGS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sleepTouched = useRef(false);

  useEffect(() => {
    let active = true;
    void wearableSleepHours(localDateString()).then((hours) => {
      if (active && hours !== null && !sleepTouched.current) {
        setSleepHours(String(hours));
        setSleepPrefilled(true);
      }
    });
    return () => {
      active = false;
    };
  }, [wearableSleepHours]);

  useEffect(() => {
    let active = true;
    void cycleContextForDate(localDateString()).then((context) => {
      if (!active) return;
      setCycleDay(context.cycle_day);
    });
    return () => {
      active = false;
    };
  }, [cycleContextForDate, cycleSummary?.days, cycleSummary?.enabled]);

  const updateRating = (key: keyof Ratings, value: Rating): void => {
    setRatings((current) => ({ ...current, [key]: value }));
  };

  const submit = async (): Promise<void> => {
    if (periodStatus === null) {
      setError("Choose None, Spotting, or Flow for today’s bleeding.");
      return;
    }
    const parsedSleep = sleepHours.trim() ? Number(sleepHours) : null;
    if (parsedSleep === null || !Number.isFinite(parsedSleep) || parsedSleep < 0 || parsedSleep > 24) {
      setError("Enter your hours of sleep (0–24).");
      return;
    }
    const { sleepQuality, stress, fatigue, brainFog, headache, pelvicPain, moodDisruption } =
      ratings;
    if (
      sleepQuality === null ||
      stress === null ||
      fatigue === null ||
      brainFog === null ||
      headache === null ||
      pelvicPain === null ||
      moodDisruption === null
    ) {
      setError("Rate every item — 0 is a valid answer for none.");
      return;
    }

    setLoading(true);
    setError(null);
    let submittedCycleDay = cycleDay;
    if (cycleSummary?.enabled) {
      const cycleResult = await logCycleDay(
        localDateString(),
        periodStatus === "none" ? null : periodStatus,
      );
      if (!cycleResult.ok) {
        setLoading(false);
        setError(cycleResult.message);
        return;
      }
      submittedCycleDay = (await cycleContextForDate(localDateString())).cycle_day;
    }
    const result = await submitCheckIn({
      client_submission_id: Crypto.randomUUID(),
      observed_date: localDateString(),
      period_status: periodStatus,
      cycle_day: submittedCycleDay,
      sleep_hours: parsedSleep,
      sleep_quality: sleepQuality,
      stress,
      fatigue,
      brain_fog: brainFog,
      headache,
      pelvic_pain: pelvicPain,
      mood_disruption: moodDisruption,
    });
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.replace("/(tabs)");
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>{shortTodayLabel().toUpperCase()}</Text>
        <Text style={styles.title}>How did today feel?</Text>
        <Text style={styles.subtitle}>
          A two-minute check-in. Use your own sense of the whole day.
        </Text>
      </View>

      {!isOnline || pendingCount > 0 ? (
        <Notice
          text={
            isOnline
              ? `${pendingCount} encrypted ${pendingCount === 1 ? "entry is" : "entries are"} waiting to sync.`
              : "You’re offline. This entry will be encrypted on your device and sent when connection returns."
          }
        />
      ) : null}
      {syncIssue ? <Notice text={syncIssue} tone="warning" /> : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Cycle context</Text>
        <Text style={styles.fieldLabel}>Today’s bleeding</Text>
        <View style={styles.segmented}>
          {PERIOD_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              accessibilityLabel={`Today’s bleeding: ${option.label}`}
              accessibilityRole="button"
              accessibilityState={{ selected: periodStatus === option.value }}
              onPress={() => setPeriodStatus(option.value)}
              style={[
                styles.segment,
                periodStatus === option.value && styles.segmentSelected,
              ]}
            >
              <Text
                style={[
                  styles.segmentLabel,
                  periodStatus === option.value && styles.segmentLabelSelected,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.helper}>
          {cycleDay === null
            ? cycleSummary?.enabled
              ? "CYCLE DAY IS AVAILABLE AFTER A FLOW START IS LOGGED"
              : "REQUIRED FOR THIS CHECK-IN · HISTORY EDITING IS OPTIONAL"
            : `AUTOMATICALLY CALCULATED · CYCLE DAY ${cycleDay}`}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Sleep & load</Text>
        <Text style={styles.fieldLabel}>Hours of sleep</Text>
        <TextInput
          accessibilityLabel="Hours of sleep"
          keyboardType="decimal-pad"
          maxLength={4}
          placeholder="e.g. 7.5"
          placeholderTextColor={colors.muted}
          value={sleepHours}
          onChangeText={(value) => {
            sleepTouched.current = true;
            setSleepPrefilled(false);
            setSleepHours(value);
          }}
          style={styles.input}
        />
        {sleepPrefilled ? (
          <Text style={styles.helper}>
            PREFILLED FROM YOUR CONNECTED HEALTH APP · EDIT IF NEEDED
          </Text>
        ) : null}
        <RatingScale
          label="Sleep quality"
          value={ratings.sleepQuality}
          lowLabel="Poor"
          highLabel="Restful"
          onChange={(value) => updateRating("sleepQuality", value)}
        />
        <RatingScale
          label="Stress"
          value={ratings.stress}
          onChange={(value) => updateRating("stress", value)}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Symptoms</Text>
        <RatingScale
          label="Fatigue"
          value={ratings.fatigue}
          onChange={(value) => updateRating("fatigue", value)}
        />
        <RatingScale
          label="Brain fog"
          value={ratings.brainFog}
          onChange={(value) => updateRating("brainFog", value)}
        />
        <RatingScale
          label="Headache or migraine"
          value={ratings.headache}
          onChange={(value) => updateRating("headache", value)}
        />
        <RatingScale
          label="Pelvic pain"
          value={ratings.pelvicPain}
          onChange={(value) => updateRating("pelvicPain", value)}
        />
        <RatingScale
          label="Mood disruption"
          value={ratings.moodDisruption}
          onChange={(value) => updateRating("moodDisruption", value)}
        />
      </View>

      {error ? <Notice text={error} tone="warning" /> : null}
      <Button label="Save today’s check-in" onPress={() => void submit()} loading={loading} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: 8,
    paddingTop: 10,
    paddingBottom: 6,
  },
  eyebrow: {
    color: colors.mineral,
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 1.1,
  },
  title: {
    color: colors.ink,
    fontFamily: type.display,
    fontSize: 39,
    lineHeight: 44,
    letterSpacing: -0.8,
  },
  subtitle: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.large,
    padding: 18,
    gap: 18,
    borderWidth: 1,
    borderColor: colors.line,
  },
  sectionTitle: {
    color: colors.ink,
    fontFamily: type.display,
    fontSize: 22,
  },
  fieldLabel: {
    color: colors.ink,
    fontFamily: type.body,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: -8,
  },
  helper: {
    color: colors.muted,
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 0.4,
    marginTop: -10,
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
    minHeight: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentSelected: {
    backgroundColor: colors.mineralDark,
  },
  segmentLabel: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 13,
    fontWeight: "700",
  },
  segmentLabelSelected: {
    color: colors.white,
  },
  input: {
    minHeight: 52,
    borderRadius: radius.medium,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.ink,
    fontFamily: type.mono,
    fontSize: 17,
    paddingHorizontal: 16,
  },
  disclaimer: {
    color: colors.muted,
    fontFamily: type.body,
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
    paddingHorizontal: 12,
  },
});
