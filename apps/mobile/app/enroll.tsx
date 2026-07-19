import { useState } from "react";
import {
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Screen } from "@/components/Screen";
import { useApp } from "@/providers/AppProvider";
import { colors, radius, type } from "@/theme";

const CONSENT_VERSION = "2026-07-01";

interface ToggleRowProps {
  readonly title: string;
  readonly detail: string;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
}

function ToggleRow({
  title,
  detail,
  value,
  onValueChange,
}: ToggleRowProps): React.ReactElement {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleCopy}>
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={styles.toggleDetail}>{detail}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.line, true: colors.mineral }}
        thumbColor={colors.white}
      />
    </View>
  );
}

export default function EnrollScreen(): React.ReactElement {
  const { enrollUser } = useApp();
  const [code, setCode] = useState("");
  const [adult, setAdult] = useState(false);
  const [operational, setOperational] = useState(false);
  const [research, setResearch] = useState(false);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setError(null);
    if (code.trim().length < 4) {
      setError("Enter the invitation code you received.");
      return;
    }
    if (!adult || !operational) {
      setError("Adult confirmation and operational processing are required to use the alpha.");
      return;
    }
    setLoading(true);
    const result = await enrollUser({
      invitation_code: code.trim(),
      adult_confirmed: adult,
      operational_consent: operational,
      research_opt_in: research,
      consent_version: CONSENT_VERSION,
      seed_demo_history: demo,
    });
    if (!result.ok) setError(result.message);
    setLoading(false);
  };

  return (
    <Screen>
      <View style={styles.hero}>
        <View style={styles.kickerRow}>
          <View style={styles.signal} />
          <Text style={styles.kicker}>PRIVATE ALPHA · CONSENT 2026-07-01</Text>
        </View>
        <Text style={styles.title}>Tomorrow,{`\n`}gently.</Text>
        <Text style={styles.subtitle}>
          A small daily signal for planning around higher-symptom days.
        </Text>
      </View>

      <Notice text="Experimental wellness forecast only. It is not a diagnosis or medical advice, and should not delay professional care." />

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Your invitation</Text>
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

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Before we begin</Text>
        <ToggleRow
          title="I confirm I’m 18 or older"
          detail="This internal alpha is for invited adults."
          value={adult}
          onValueChange={setAdult}
        />
        <View style={styles.rule} />
        <ToggleRow
          title="Use my data to operate the app"
          detail="Required to store check-ins and create forecasts."
          value={operational}
          onValueChange={setOperational}
        />
      </View>

      <View style={styles.researchCard}>
        <Text style={styles.optional}>OPTIONAL RESEARCH</Text>
        <ToggleRow
          title="Contribute pseudonymous records"
          detail="Separate from app access. You can withdraw later and your research rows will be removed."
          value={research}
          onValueChange={setResearch}
        />
        <Text style={styles.finePrint}>
          Records are pseudonymous, not anonymous. They contain structured daily measurements—never free text, location, contacts, or ad identifiers.
        </Text>
      </View>

      <View style={styles.card}>
        <ToggleRow
          title="Load a seven-day demo"
          detail="Preloads synthetic history so the forecast is ready for a hackathon demonstration."
          value={demo}
          onValueChange={setDemo}
        />
      </View>

      {error ? <Notice text={error} tone="warning" /> : null}
      <Button label="Enter the private alpha" onPress={() => void submit()} loading={loading} />
      <Text style={styles.footer}>
        By continuing, you accept consent version {CONSENT_VERSION}. Transport and local queued records are encrypted.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    paddingTop: 20,
    paddingBottom: 8,
    gap: 12,
  },
  kickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  signal: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.amber,
  },
  kicker: {
    color: colors.mineralDark,
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: 1,
  },
  title: {
    color: colors.ink,
    fontFamily: type.display,
    fontSize: 56,
    lineHeight: 58,
    letterSpacing: -1.8,
  },
  subtitle: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 17,
    lineHeight: 25,
    maxWidth: 320,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.large,
    padding: 18,
    gap: 16,
    borderWidth: 1,
    borderColor: colors.line,
  },
  researchCard: {
    backgroundColor: colors.amberSoft,
    borderRadius: radius.large,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: "#E9D29F",
  },
  sectionTitle: {
    color: colors.ink,
    fontFamily: type.display,
    fontSize: 21,
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
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  toggleCopy: {
    flex: 1,
    gap: 4,
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
  rule: {
    height: 1,
    backgroundColor: colors.line,
  },
  finePrint: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 11,
    lineHeight: 17,
  },
  footer: {
    color: colors.muted,
    fontFamily: type.body,
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
    paddingHorizontal: 12,
  },
});
