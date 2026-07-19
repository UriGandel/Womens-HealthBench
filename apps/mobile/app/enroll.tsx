import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Screen } from "@/components/Screen";
import { useApp } from "@/providers/AppProvider";
import { getHealthAvailability } from "@/services/healthData";
import { colors, radius, type } from "@/theme";

const CONSENT_VERSION = "2026-07-19-intraday-cycle-v2";
const STEPS = ["Disclaimers", "Consent", "Health sync"] as const;

const DISCLAIMERS: ReadonlyArray<{
  readonly title: string;
  readonly detail: string;
}> = [
  {
    title: "Private alpha",
    detail:
      "An experimental app for adults only. By tapping “I agree” you confirm you are 18 or older.",
  },
  {
    title: "Not medical advice",
    detail:
      "An experimental wellness forecast, not a diagnosis. It should never delay professional care.",
  },
  {
    title: "Your data",
    detail:
      "Check-ins and optional health summaries are stored encrypted. Every check-in asks about bleeding; separate cycle-history editing remains optional.",
  },
];

// Step names are intentionally not rendered — the label shows only the count
// (each step's heading already says what it is). STEPS entries are keys only.
function StepMeter({ step }: { readonly step: number }): React.ReactElement {
  return (
    <View style={styles.stepMeter}>
      <Text style={styles.stepLabel}>
        STEP {step + 1} OF {STEPS.length}
      </Text>
      <View style={styles.stepTrack}>
        {STEPS.map((name, index) => (
          <View
            key={name}
            style={[
              styles.stepSegment,
              index < step && styles.stepSegmentDone,
              index === step && styles.stepSegmentCurrent,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

export default function EnrollScreen(): React.ReactElement {
  const {
    completeEnrollment,
    connectHealth,
    enrollUser,
    isHealthSyncing,
  } = useApp();
  const { width } = useWindowDimensions();
  const useNarrowFooter = width < 360;
  const healthAvailability = getHealthAvailability();
  const healthName =
    healthAvailability.platform === "apple_health"
      ? "Apple Health"
      : "Health Connect";
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [healthConnected, setHealthConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goNext = (): void => {
    setError(null);
    setStep(1);
  };

  const goBack = (): void => {
    setError(null);
    setStep(0);
  };

  // Tapping "I agree" on each step is the explicit affirmative act for the
  // statements shown on that step: 18+, data processing, then research use.
  const submit = async (): Promise<void> => {
    setError(null);
    setLoading(true);
    const result = await enrollUser({
      adult_confirmed: true,
      operational_consent: true,
      research_consent: true,
      consent_version: CONSENT_VERSION,
    });
    if (result.ok) {
      setStep(2);
    } else {
      setError(result.message);
    }
    setLoading(false);
  };

  const connect = async (): Promise<void> => {
    setError(null);
    const result = await connectHealth();
    if (result.ok) {
      setHealthConnected(true);
    } else {
      setError(result.message);
    }
  };

  const finish = (): void => {
    completeEnrollment();
  };

  const footer = (
    <>
      {error ? <Notice text={error} tone="warning" /> : null}
      <View style={styles.footerButtons}>
        {step === 1 ? (
          <View
            style={[
              styles.footerButton,
              useNarrowFooter && styles.narrowBackButton,
            ]}
          >
            <Button label="Back" variant="secondary" onPress={goBack} disabled={loading} />
          </View>
        ) : null}
        <View
          style={[
            styles.footerButton,
            step === 1 && useNarrowFooter && styles.narrowPrimaryButton,
          ]}
        >
          {step === 0 ? <Button label="I agree" onPress={goNext} /> : null}
          {step === 1 ? (
            <Button
              label="I agree"
              onPress={() => void submit()}
              loading={loading}
            />
          ) : null}
          {step === 2 && healthConnected ? (
            <Button label="Continue to my forecast" onPress={finish} />
          ) : null}
          {step === 2 && !healthConnected && !healthAvailability.available ? (
            <Button label="Continue without syncing" onPress={finish} />
          ) : null}
        </View>
        {step === 2 && !healthConnected && healthAvailability.available ? (
          <>
            <View style={styles.footerButton}>
              <Button
                label="Skip for now"
                variant="secondary"
                onPress={finish}
                disabled={isHealthSyncing}
              />
            </View>
            <View style={styles.footerButton}>
              <Button
                label={`Connect ${healthName}`}
                onPress={() => void connect()}
                loading={isHealthSyncing}
              />
            </View>
          </>
        ) : null}
      </View>
    </>
  );

  const heading = [
    {
      title: "Tomorrow, gently.",
      subtitle: "A small daily signal for planning around high-symptom days.",
    },
    {
      title: "Research consent",
      subtitle: "Participation is required for this private alpha.",
    },
    {
      title: "Make your forecast more personal.",
      subtitle: `Optionally sync daily and six-hour signals from ${healthName}.`,
    },
  ][step];

  const header = (
    <>
      <Text style={styles.stepTitle}>{heading?.title}</Text>
      <Text style={styles.subtitle}>{heading?.subtitle}</Text>
      <StepMeter step={step} />
    </>
  );

  return (
    <Screen header={header} footer={footer}>
      {step === 0 ? (
        <>
          <View style={styles.disclaimerCard}>
            {DISCLAIMERS.map((item) => (
              <View key={item.title} style={styles.bulletRow}>
                <View style={styles.bulletMark} />
                <View style={styles.bulletCopy}>
                  <Text style={styles.bulletTitle}>{item.title}</Text>
                  <Text style={styles.bulletDetail}>{item.detail}</Text>
                </View>
              </View>
            ))}
          </View>
          {Platform.OS === "web" ? (
            <Notice text="Browser preview: device authentication and health-app imports are unavailable, and local data is erased when this page reloads." />
          ) : null}
        </>
      ) : null}

      {/*
        Deliberate consent design — do not "restore" removed pieces:
        - No Yes/No toggle here. Research participation is mandatory for this
          alpha, so a toggle would be a fake choice; tapping "I agree" below is
          the single explicit affirmative act. Declining = leaving enrollment
          ("Back" or closing the app), and nothing is stored until enrollment.
        - Plain white card (styles.researchCard), not an amber/warning tint:
          this is a consent statement, not an alert.
      */}
      {step === 1 ? (
        <View style={styles.researchCard}>
          <Text style={styles.required}>REQUIRED RESEARCH PARTICIPATION</Text>
          <Text style={styles.toggleTitle}>Contribute pseudonymous records</Text>
          <Text style={styles.toggleDetail}>
            Every accepted check-in and health-app summary you choose to import contributes to forecasting evaluation and the research dataset. Delete your account at any time to leave and remove all records.
          </Text>
          <Text style={styles.finePrint}>
            Records are pseudonymous, not anonymous. Imported data includes daily
            summaries and completed six-hour aggregates, including ordinary heart
            rate. Raw sensor samples, timestamps, routes, location, and device or
            source-app IDs are excluded. Approximate cycle phases may be shown in
            the app but are not research labels or fertility guidance.
          </Text>
          <Text style={styles.finePrint}>
            Research participation is required for this private alpha. If you would rather not contribute, go back or close the app — nothing is stored unless you agree.
          </Text>
          <Text style={styles.consentVersion}>
            By tapping “I agree”, you accept consent version {CONSENT_VERSION}.
          </Text>
        </View>
      ) : null}

      {step === 2 ? (
        <>
          <View style={styles.healthCard}>
            <View style={styles.healthIcon}>
              <Ionicons
                name={
                  healthAvailability.platform === "apple_health"
                    ? "heart"
                    : "fitness"
                }
                size={30}
                color={colors.mineralDark}
              />
            </View>
            <View style={styles.healthCopy}>
              <Text style={styles.healthTitle}>
                {healthConnected
                  ? `${healthName} is connected`
                  : `Sync with ${healthName}`}
              </Text>
              <Text style={styles.healthDetail}>
                {healthConnected
                  ? "Your available daily and completed six-hour summaries have been securely imported."
                  : "Add sleep plus intraday activity and heart-health trends. These new fields do not change the current forecast."}
              </Text>
            </View>
          </View>

          {!healthAvailability.available ? (
            <Notice
              tone="warning"
              text={
                healthAvailability.needsInstallOrUpdate
                  ? "Install or update Health Connect to sync later from Your data."
                  : Platform.OS === "web"
                    ? "Health sync is only available in the iOS or Android app. You can continue with the browser preview."
                    : "Health sync is unavailable on this device or build. You can connect later from Your data."
              }
            />
          ) : null}

          <View style={styles.healthDetailsCard}>
            <View style={styles.healthDetailRow}>
              <Ionicons name="calendar-outline" size={19} color={colors.mineral} />
              <Text style={styles.healthDetailText}>
                Imports up to 31 days of daily and completed six-hour summaries
              </Text>
            </View>
            <View style={styles.healthDetailRow}>
              <Ionicons name="eye-off-outline" size={19} color={colors.mineral} />
              <Text style={styles.healthDetailText}>
                Never imports raw samples, routes, or device identifiers
              </Text>
            </View>
            <View style={styles.healthDetailRow}>
              <Ionicons name="shield-checkmark-outline" size={19} color={colors.mineral} />
              <Text style={styles.healthDetailText}>
                Read-only, optional, and removable at any time
              </Text>
            </View>
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stepTitle: {
    color: colors.ink,
    fontFamily: type.display,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.6,
  },
  subtitle: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 15,
    lineHeight: 23,
    maxWidth: 320,
  },
  stepMeter: { gap: 8 },
  stepLabel: {
    color: colors.mineral,
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 1.1,
  },
  stepTrack: { flexDirection: "row", gap: 4 },
  stepSegment: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
  },
  stepSegmentDone: { backgroundColor: colors.moss },
  stepSegmentCurrent: { backgroundColor: colors.amber },
  disclaimerCard: {
    backgroundColor: colors.white,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 22,
    paddingVertical: 26,
    gap: 26,
  },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  bulletMark: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.amber,
    marginTop: 7,
  },
  bulletCopy: { flex: 1, gap: 6 },
  bulletTitle: {
    color: colors.ink,
    fontFamily: type.body,
    fontSize: 16,
    fontWeight: "700",
  },
  bulletDetail: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 13,
    lineHeight: 21,
  },
  // Intentionally the same neutral white card as the disclaimers step — the
  // amber tint was removed because consent copy is not a warning banner.
  researchCard: {
    backgroundColor: colors.white,
    borderRadius: radius.large,
    padding: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  healthCard: {
    backgroundColor: colors.white,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 20,
    gap: 16,
    alignItems: "center",
  },
  healthIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.mineralSoft,
  },
  healthCopy: {
    alignItems: "center",
    gap: 7,
  },
  healthTitle: {
    color: colors.ink,
    fontFamily: type.display,
    fontSize: 23,
    lineHeight: 29,
    textAlign: "center",
  },
  healthDetail: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  healthDetailsCard: {
    backgroundColor: colors.paper,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
    gap: 15,
  },
  healthDetailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  healthDetailText: {
    flex: 1,
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 13,
    lineHeight: 19,
  },
  required: {
    color: colors.plum,
    fontFamily: type.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  toggleTitle: {
    color: colors.ink,
    fontFamily: type.body,
    fontSize: 15,
    fontWeight: "700",
  },
  toggleDetail: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 12,
    lineHeight: 18,
  },
  finePrint: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 13,
    lineHeight: 20,
  },
  // Matches finePrint so the consent-version line reads as part of the same
  // block of copy, not as a smaller afterthought.
  consentVersion: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 13,
    lineHeight: 20,
  },
  footerButtons: { flexDirection: "row", gap: 10 },
  footerButton: { flex: 1 },
  narrowBackButton: { flex: 0.7 },
  narrowPrimaryButton: { flex: 1.3 },
});
