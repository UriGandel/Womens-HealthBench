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
import { Screen } from "@/components/Screen";
import { useApp } from "@/providers/AppProvider";
import { checkInvitation } from "@/services/api";
import { colors, radius, type } from "@/theme";

const CONSENT_VERSION = "2026-07-01";

const STEPS = ["Invitation", "Disclaimers", "Settings"] as const;

const DISCLAIMERS: ReadonlyArray<{
  readonly title: string;
  readonly detail: string;
}> = [
  {
    title: "Private alpha",
    detail: "An experimental app for adults 18 or older.",
  },
  {
    title: "Not medical advice",
    detail:
      "An experimental wellness forecast, not a diagnosis. It should never delay professional care.",
  },
  {
    title: "Your data",
    detail:
      "Check-ins are stored encrypted to run the app and build forecasts. No free text, location, contacts, or ad identifiers.",
  },
];

interface YesNoRowProps {
  readonly title: string;
  readonly detail: string;
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
}

function YesNoRow({
  title,
  detail,
  value,
  onChange,
}: YesNoRowProps): React.ReactElement {
  return (
    <View style={styles.yesNoRow}>
      <Text style={styles.toggleTitle}>{title}</Text>
      <Text style={styles.toggleDetail}>{detail}</Text>
      <View style={styles.segmented}>
        {[false, true].map((option) => (
          <Pressable
            key={option ? "yes" : "no"}
            accessibilityRole="button"
            accessibilityState={{ selected: value === option }}
            onPress={() => onChange(option)}
            style={[styles.segment, value === option && styles.segmentSelected]}
          >
            <Text
              style={[
                styles.segmentLabel,
                value === option && styles.segmentLabelSelected,
              ]}
            >
              {option ? "Yes" : "No"}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function StepMeter({ step }: { readonly step: number }): React.ReactElement {
  return (
    <View style={styles.stepMeter}>
      <Text style={styles.stepLabel}>
        STEP {step + 1} OF {STEPS.length} · {(STEPS[step] ?? "").toUpperCase()}
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
  const { enrollUser } = useApp();
  const [step, setStep] = useState(0);
  const [code, setCode] = useState("");
  const [research, setResearch] = useState(false);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goNext = async (): Promise<void> => {
    setError(null);
    if (step === 0) {
      const trimmed = code.trim();
      if (trimmed.length < 4) {
        setError("Enter the invitation code you received.");
        return;
      }
      setChecking(true);
      const result = await checkInvitation(trimmed);
      setChecking(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (!result.value.valid) {
        setError(result.value.detail ?? "Invitation is invalid or already used.");
        return;
      }
    }
    setStep(step + 1);
  };

  const goBack = (): void => {
    setError(null);
    setStep(step - 1);
  };

  const submit = async (): Promise<void> => {
    setError(null);
    setLoading(true);
    const result = await enrollUser({
      invitation_code: code.trim(),
      // Reaching this step requires the explicit "I agree" tap on the
      // disclaimers screen, which covers both confirmations below.
      adult_confirmed: true,
      operational_consent: true,
      research_opt_in: research,
      consent_version: CONSENT_VERSION,
      seed_demo_history: demo,
    });
    if (!result.ok) setError(result.message);
    setLoading(false);
  };

  const footer = (
    <>
      {error ? <Notice text={error} tone="warning" /> : null}
      <View style={styles.footerButtons}>
        {step > 0 ? (
          <View style={styles.footerButton}>
            <Button
              label="Back"
              variant="secondary"
              onPress={goBack}
              disabled={loading || checking}
            />
          </View>
        ) : null}
        <View style={styles.footerButton}>
          {step === 0 ? (
            <Button
              label="Continue"
              onPress={() => void goNext()}
              loading={checking}
            />
          ) : null}
          {step === 1 ? (
            <Button label="I agree" onPress={() => void goNext()} />
          ) : null}
          {step === 2 ? (
            <Button
              label="Enter"
              onPress={() => void submit()}
              loading={loading}
            />
          ) : null}
        </View>
      </View>
    </>
  );

  const heading = [
    {
      title: "Tomorrow, gently.",
      subtitle: "A small daily signal for planning around higher-symptom days.",
    },
    {
      title: "Onboarding",
      subtitle: "Three things to know.",
    },
    {
      title: "Optional settings",
      subtitle: "Change these anytime.",
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
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Your invitation</Text>
            <Text style={styles.helper}>
              Enter the code you received.
            </Text>
            <TextInput
              accessibilityLabel="Invitation code"
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="Enter code"
              placeholderTextColor={colors.muted}
              value={code}
              onChangeText={setCode}
              style={styles.input}
            />
          </View>
        </>
      ) : null}

      {step === 1 ? (
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
        </>
      ) : null}

      {step === 2 ? (
        <>
          <View style={styles.card}>
            <Text style={styles.optional}>OPTIONAL RESEARCH</Text>
            <YesNoRow
              title="Contribute pseudonymous records"
              detail="Separate from app access. You can withdraw later and your research rows will be removed."
              value={research}
              onChange={setResearch}
            />
            <Text style={styles.finePrint}>
              Records are pseudonymous, not anonymous. They contain structured daily measurements—never free text, location, contacts, or ad identifiers.
            </Text>
          </View>
          <View style={styles.card}>
            <YesNoRow
              title="Load a seven-day demo"
              detail="Preloads synthetic history so the forecast is ready for a hackathon demonstration."
              value={demo}
              onChange={setDemo}
            />
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
  stepMeter: {
    gap: 8,
  },
  stepLabel: {
    color: colors.mineral,
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 1.1,
  },
  stepTrack: {
    flexDirection: "row",
    gap: 4,
  },
  stepSegment: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
  },
  stepSegmentDone: {
    backgroundColor: colors.moss,
  },
  stepSegmentCurrent: {
    backgroundColor: colors.amber,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.large,
    padding: 18,
    gap: 16,
    borderWidth: 1,
    borderColor: colors.line,
  },
  sectionTitle: {
    color: colors.ink,
    fontFamily: type.display,
    fontSize: 21,
  },
  helper: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 12,
    lineHeight: 18,
  },
  optional: {
    color: colors.plum,
    fontFamily: type.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  input: {
    minHeight: 54,
    borderRadius: radius.medium,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.ink,
    fontFamily: type.mono,
    fontSize: 18,
    paddingHorizontal: 16,
    letterSpacing: 1,
  },
  disclaimerCard: {
    backgroundColor: colors.white,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 22,
    paddingVertical: 26,
    gap: 26,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },
  bulletMark: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.amber,
    marginTop: 7,
  },
  bulletCopy: {
    flex: 1,
    gap: 6,
  },
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
  yesNoRow: {
    gap: 8,
  },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.paper,
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 4,
    gap: 4,
    marginTop: 4,
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
  finePrint: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 13,
    lineHeight: 20,
  },
  footerButtons: {
    flexDirection: "row",
    gap: 10,
  },
  footerButton: {
    flex: 1,
  },
});
