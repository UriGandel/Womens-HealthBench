import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Screen } from "@/components/Screen";
import { useApp } from "@/providers/AppProvider";
import { colors, radius, type } from "@/theme";
import type { ForecastFactor } from "@/types";

const METER_SEGMENTS = Array.from({ length: 10 }, (_, index) => index);

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
    refresh,
  } = useApp();
  const usable = forecast?.usable_checkins ?? account?.checkin_count ?? 0;
  const required = forecast?.required_checkins ?? 7;
  const progress = Math.min(usable / required, 1);
  const ready = forecast?.status === "ready" && forecast.probability !== null;
  const probability = ready ? forecast.probability : 0;
  const percentage = Math.round(probability * 100);

  return (
    <Screen>
      <View style={styles.topline}>
        <View>
          <Text style={styles.eyebrow}>NEXT-DAY SIGNAL</Text>
          <Text style={styles.wordmark}>Tomorrow, gently</Text>
        </View>
        <View style={[styles.status, !isOnline && styles.statusOffline]}>
          <View style={[styles.statusDot, !isOnline && styles.statusDotOffline]} />
          <Text style={styles.statusText}>{isOnline ? "Synced" : "Offline"}</Text>
        </View>
      </View>

      {pendingCount > 0 ? (
        <Notice text={`${pendingCount} encrypted ${pendingCount === 1 ? "check-in is" : "check-ins are"} waiting to sync.`} />
      ) : null}

      <View style={styles.instrument}>
        <View style={styles.dialOuter}>
          <View style={styles.dialMiddle}>
            <View style={styles.dialInner}>
              <Text style={styles.dialLabel}>{ready ? "LIKELIHOOD" : "LEARNING"}</Text>
              <Text style={styles.probability}>{ready ? `${percentage}%` : `${usable}/${required}`}</Text>
              <Text style={styles.confidence}>
                {ready ? `${forecast.confidence ?? "low"} confidence` : "usable days"}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.meter}>
          {METER_SEGMENTS.map((segment) => {
            const filled = ready
              ? segment < Math.round(probability * 10)
              : segment < Math.round(progress * 10);
            return (
              <View
                key={segment}
                style={[styles.meterSegment, filled && styles.meterSegmentFilled]}
              />
            );
          })}
        </View>

        <Text style={styles.instrumentTitle}>
          {ready
            ? percentage >= 50
              ? "A higher-symptom day is more likely"
              : "A higher-symptom day is less likely"
            : "Your personal pattern is taking shape"}
        </Text>
        <Text style={styles.instrumentDetail}>
          {ready
            ? "Use this as one planning signal, not a certainty."
            : `Add ${Math.max(required - usable, 0)} more daily ${required - usable === 1 ? "check-in" : "check-ins"} to unlock your first personal forecast.`}
        </Text>
      </View>

      {ready && forecast.factors.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardKicker}>WHAT SHAPED THIS SIGNAL</Text>
          {forecast.factors.map((factor, index) => (
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
              {index < forecast.factors.length - 1 ? null : null}
            </View>
          ))}
          <Text style={styles.nonCausal}>
            These are model inputs associated with the forecast—not identified causes.
          </Text>
        </View>
      ) : null}

      <View style={styles.metaCard}>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Model</Text>
          <Text style={styles.metaValue}>{forecast?.model_version ?? "Loading"}</Text>
        </View>
        <View style={styles.rule} />
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Horizon</Text>
          <Text style={styles.metaValue}>Tomorrow</Text>
        </View>
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
  eyebrow: {
    color: colors.mineral,
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 1.3,
  },
  wordmark: {
    color: colors.ink,
    fontFamily: type.display,
    fontSize: 22,
    fontWeight: "600",
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
  dialLabel: {
    color: "#C6DEDF",
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 1.3,
  },
  probability: {
    color: colors.white,
    fontFamily: type.display,
    fontSize: 47,
    lineHeight: 54,
    fontWeight: "600",
  },
  confidence: {
    color: colors.amberSoft,
    fontFamily: type.body,
    fontSize: 11,
    textTransform: "capitalize",
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
    fontWeight: "600",
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
  cardKicker: {
    color: colors.mineral,
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 1,
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
  nonCausal: {
    color: colors.muted,
    fontFamily: type.body,
    fontSize: 10,
    lineHeight: 15,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 12,
  },
  metaCard: {
    backgroundColor: colors.paper,
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
  },
  metaRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metaLabel: {
    color: colors.muted,
    fontFamily: type.body,
    fontSize: 12,
  },
  metaValue: {
    color: colors.ink,
    fontFamily: type.mono,
    fontSize: 11,
  },
  rule: {
    height: 1,
    backgroundColor: colors.line,
  },
});
