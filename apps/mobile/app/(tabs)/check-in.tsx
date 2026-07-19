import * as Crypto from "expo-crypto";
import { useRouter } from "expo-router";
import { useState } from "react";
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
  readonly sleepQuality: Rating;
  readonly stress: Rating;
  readonly fatigue: Rating;
  readonly brainFog: Rating;
  readonly headache: Rating;
  readonly pelvicPain: Rating;
  readonly moodDisruption: Rating;
}

const INITIAL_RATINGS: Ratings = {
  sleepQuality: 2,
  stress: 2,
  fatigue: 2,
  brainFog: 0,
  headache: 0,
  pelvicPain: 0,
  moodDisruption: 0,
};

export default function CheckInScreen(): React.ReactElement {
  const { submitCheckIn, isOnline, pendingCount, syncIssue } = useApp();
  const router = useRouter();
  const [periodStatus, setPeriodStatus] = useState<PeriodStatus>("none");
  const [cycleDay, setCycleDay] = useState("");
  const [sleepHours, setSleepHours] = useState("7.5");
  const [ratings, setRatings] = useState<Ratings>(INITIAL_RATINGS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateRating = (key: keyof Ratings, value: Rating): void => {
    setRatings((current) => ({ ...current, [key]: value }));
  };

  const submit = async (): Promise<void> => {
    const parsedSleep = Number(sleepHours);
    const parsedCycle = cycleDay.trim() ? Number(cycleDay) : null;
    if (!Number.isFinite(parsedSleep) || parsedSleep < 0 || parsedSleep > 24) {
      setError("Sleep duration must be between 0 and 24 hours.");
      return;
    }
    if (
      parsedCycle !== null &&
      (!Number.isInteger(parsedCycle) || parsedCycle < 1 || parsedCycle > 120)
    ) {
      setError("Cycle day must be a whole number from 1 to 120, or left blank.");
      return;
    }

    setLoading(true);
    setError(null);
    const result = await submitCheckIn({
      client_submission_id: Crypto.randomUUID(),
      observed_date: localDateString(),
      period_status: periodStatus,
      cycle_day: parsedCycle,
      sleep_hours: parsedSleep,
      sleep_quality: ratings.sleepQuality,
      stress: ratings.stress,
      fatigue: ratings.fatigue,
      brain_fog: ratings.brainFog,
      headache: ratings.headache,
      pelvic_pain: ratings.pelvicPain,
      mood_disruption: ratings.moodDisruption,
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
        <Text style={styles.fieldLabel}>Period status</Text>
        <View style={styles.segmented}>
          {PERIOD_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
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
        <Text style={styles.fieldLabel}>Cycle day · optional</Text>
        <TextInput
          accessibilityLabel="Cycle day, optional"
          keyboardType="number-pad"
          maxLength={3}
          placeholder="e.g. 14"
          placeholderTextColor={colors.muted}
          value={cycleDay}
          onChangeText={setCycleDay}
          style={styles.input}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Sleep & load</Text>
        <Text style={styles.fieldLabel}>Hours of sleep</Text>
        <TextInput
          accessibilityLabel="Hours of sleep"
          keyboardType="decimal-pad"
          maxLength={4}
          value={sleepHours}
          onChangeText={setSleepHours}
          style={styles.input}
        />
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
        <Text style={styles.helper}>0 = none · 4 = severe disruption</Text>
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
      <Text style={styles.disclaimer}>
        This structured check-in does not collect notes, location, contacts, or advertising identifiers.
      </Text>
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
    fontWeight: "600",
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
    fontWeight: "600",
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
