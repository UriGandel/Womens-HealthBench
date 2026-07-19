import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Screen } from "@/components/Screen";
import { useApp } from "@/providers/AppProvider";
import { colors, radius, type } from "@/theme";
import type { ForecastFactor } from "@/types";
import { localDateString } from "@/utils/date";

function factorIcon(factor: ForecastFactor): keyof typeof Ionicons.glyphMap {
  if (factor.direction === "higher") return "arrow-up";
  if (factor.direction === "lower") return "arrow-down";
  return "information";
}

export default function ForecastScreen(): React.ReactElement {
  const {
    forecast,
    account,
    pendingCount,
    isOnline,
    isRefreshing,
    lastCheckInDate,
    syncIssue,
    refresh,
  } = useApp();
  const checkedInToday = lastCheckInDate === localDateString();
  const usable = forecast?.usable_checkins ?? account?.checkin_count ?? 0;
  const required = forecast?.required_checkins ?? 7;
  const ready = forecast?.status === "ready" && forecast.probability !== null;
  const probability = ready ? forecast.probability : 0;
  const percentage = Math.round(probability * 100);

  return (
    <Screen>
      <View style={styles.topline}>
        <Text style={styles.wordmark}>Tomorrow, gently</Text>
        {!isOnline ? (
          <View style={[styles.status, styles.statusOffline]}>
            <View style={[styles.statusDot, styles.statusDotOffline]} />
            <Text style={styles.statusText}>Offline</Text>
          </View>
        ) : null}
      </View>

      {syncIssue ? <Notice text={syncIssue} tone="warning" /> : null}
      {pendingCount > 0 ? (
        <Notice text={`${pendingCount} encrypted ${pendingCount === 1 ? "check-in is" : "check-ins are"} waiting to sync.`} />
      ) : null}

      <View style={styles.instrument}>
        <View style={styles.dialOuter}>
          <View style={styles.dialMiddle}>
            <View style={styles.dialInner}>
              <Text style={styles.probability}>{ready ? `${percentage}%` : `${usable}/${required}`}</Text>
              <Text style={styles.confidence}>{ready ? "chance tomorrow" : "check-ins"}</Text>
            </View>
          </View>
        </View>

        {!ready ? (
          <View style={styles.meter}>
            {Array.from({ length: required }, (_, i) => i).map((segment) => (
              <View
                key={segment}
                style={[styles.meterSegment, segment < usable && styles.meterSegmentFilled]}
              />
            ))}
          </View>
        ) : null}

        <Text style={styles.instrumentTitle}>
          {ready
            ? percentage >= 50
              ? "A higher-symptom day is more likely"
              : "A higher-symptom day is less likely"
            : checkedInToday
              ? "Today’s check-in is saved"
              : "Check in daily to unlock your forecast"}
        </Text>
        {!ready ? (
          <Text style={styles.instrumentDetail}>
            {checkedInToday
              ? "Come back tomorrow for the next one."
              : "It estimates tomorrow's chance of a higher-symptom day."}
          </Text>
        ) : null}

        {ready && forecast.factors.length > 0 ? (
          <View style={styles.factorList}>
            {forecast.factors.map((factor) => (
              <View key={`${factor.label}-${factor.direction}`} style={styles.factor}>
                <View
                  style={[
                    styles.factorIcon,
                    factor.direction === "higher" && styles.factorIconHigher,
                  ]}
                >
                  <Ionicons
                    name={factorIcon(factor)}
                    size={15}
                    color={factor.direction === "higher" ? colors.plum : colors.mineralDark}
                  />
                </View>
                <View style={styles.factorCopy}>
                  <Text style={styles.factorTitle}>{factor.label}</Text>
                  <Text style={styles.factorDetail}>{factor.detail}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {ready ? (
          <Text style={styles.confidenceFootnote}>
            {forecast.confidence === "high"
              ? `High confidence — based on ${usable} check-ins.`
              : `${forecast.confidence === "medium" ? "Medium" : "Low"} confidence — improves as you log more days.`}
          </Text>
        ) : null}
      </View>

      <Button
        label={isRefreshing ? "Refreshing…" : "Refresh signal"}
        variant="secondary"
        disabled={!isOnline}
        loading={isRefreshing}
        onPress={() => void refresh()}
      />
      <Notice
        tone="warning"
        text={
          forecast?.disclaimer ??
          "Experimental wellness forecast only. Not a diagnosis or medical advice. Do not delay professional care."
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  topline: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 8,
  },
  wordmark: {
    color: colors.ink,
    fontFamily: type.display,
    fontSize: 22,
    marginTop: 3,
  },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.mineralSoft,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  statusOffline: {
    backgroundColor: colors.amberSoft,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.mineral,
  },
  statusDotOffline: {
    backgroundColor: colors.amber,
  },
  statusText: {
    color: colors.ink,
    fontFamily: type.mono,
    fontSize: 10,
  },
  instrument: {
    backgroundColor: colors.white,
    borderRadius: 36,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 22,
    paddingVertical: 28,
    alignItems: "center",
    gap: 16,
  },
  dialOuter: {
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 1,
    borderColor: colors.mineralSoft,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paper,
  },
  dialMiddle: {
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 9,
    borderColor: colors.mineralSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  dialInner: {
    width: 144,
    height: 144,
    borderRadius: 72,
    backgroundColor: colors.mineralDark,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  probability: {
    color: colors.white,
    fontFamily: type.display,
    fontSize: 47,
    lineHeight: 54,
  },
  confidence: {
    color: colors.white,
    fontFamily: type.body,
    fontSize: 11,
  },
  factorList: {
    width: "100%",
    gap: 14,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 16,
  },
  confidenceFootnote: {
    color: colors.muted,
    fontFamily: type.body,
    fontSize: 12,
    textAlign: "center",
  },
  meter: {
    width: "100%",
    flexDirection: "row",
    gap: 4,
  },
  meterSegment: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
  },
  meterSegmentFilled: {
    backgroundColor: colors.amber,
  },
  instrumentTitle: {
    color: colors.ink,
    fontFamily: type.display,
    fontSize: 24,
    lineHeight: 29,
    textAlign: "center",
  },
  instrumentDetail: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
    gap: 14,
  },
  factor: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  factorIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.mineralSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  factorIconHigher: {
    backgroundColor: colors.amberSoft,
  },
  factorCopy: {
    flex: 1,
    gap: 2,
  },
  factorTitle: {
    color: colors.ink,
    fontFamily: type.body,
    fontSize: 14,
    fontWeight: "700",
  },
  factorDetail: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 12,
    lineHeight: 18,
  },
});
