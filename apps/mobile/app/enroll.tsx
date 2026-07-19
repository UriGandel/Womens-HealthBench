import { useState } from "react";
import {
  Platform,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Screen } from "@/components/Screen";
import { useApp } from "@/providers/AppProvider";
import { colors, radius, type } from "@/theme";

const CONSENT_VERSION = "2026-07-19-health-v1";

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
  const [adult, setAdult] = useState(false);
  const [operational, setOperational] = useState(false);
  const [research, setResearch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setError(null);
    if (!adult || !operational || !research) {
      setError(
        "Adult confirmation, operational processing, and research participation are required.",
      );
      return;
    }
    setLoading(true);
    const result = await enrollUser({
      adult_confirmed: adult,
      operational_consent: operational,
      research_consent: research,
      consent_version: CONSENT_VERSION,
    });
    if (!result.ok) setError(result.message);
    setLoading(false);
  };

  return (
    <Screen>
      <View style={styles.hero}>
        <View style={styles.kickerRow}>
          <View style={styles.signal} />
          <Text style={styles.kicker}>PRIVATE ALPHA · CONSENT HEALTH V1</Text>
        </View>
        <Text style={styles.title}>Tomorrow,{`\n`}gently.</Text>
        <Text style={styles.subtitle}>
          A small daily signal for planning around higher-symptom days.
        </Text>
      </View>

      <Notice text="Experimental wellness forecast only. It is not a diagnosis or medical advice, and should not delay professional care." />
      {Platform.OS === "web" ? (
        <Notice text="Browser preview: device authentication and health-app imports are unavailable, and local data is erased when this page reloads." />
      ) : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Before we begin</Text>
        <ToggleRow
          title="I confirm I’m 18 or older"
          detail="This internal alpha is for adults."
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
        <Text style={styles.required}>REQUIRED RESEARCH PARTICIPATION</Text>
        <ToggleRow
          title="Contribute pseudonymous records"
          detail="Every accepted check-in and any health-app summaries you choose to import contribute to forecasting evaluation and the research dataset. Delete your account at any time to leave and remove all records."
          value={research}
          onValueChange={setResearch}
        />
        <Text style={styles.finePrint}>
          Records are pseudonymous, not anonymous. Imported health data is
          retained as daily summaries until you disconnect it or delete your
          account. We never import raw samples, routes, location, device IDs,
          source-app IDs, or reproductive and clinical records.
        </Text>
      </View>

      {error ? <Notice text={error} tone="warning" /> : null}
      <Button
        label={Platform.OS === "web" ? "Join browser preview" : "Authenticate and join"}
        onPress={() => void submit()}
        loading={loading}
      />
      <Text style={styles.footer}>
        {Platform.OS === "web"
          ? `By continuing, you accept consent version ${CONSENT_VERSION}. Transport uses the configured API connection; local preview data is not persisted.`
          : `By continuing, you accept consent version ${CONSENT_VERSION}. Transport and local queued records are encrypted.`}
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
    fontWeight: "600",
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
    fontWeight: "600",
  },
  required: {
    color: colors.plum,
    fontFamily: type.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
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
