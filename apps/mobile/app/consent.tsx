import { useState } from "react";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Screen } from "@/components/Screen";
import { useApp } from "@/providers/AppProvider";
import { colors, radius, type } from "@/theme";

export default function ConsentScreen(): React.ReactElement {
  const { acceptCurrentConsent, deleteAccount, isOnline } = useApp();
  const [operational, setOperational] = useState(false);
  const [research, setResearch] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async (): Promise<void> => {
    if (!operational || !research) {
      setError("Both confirmations are required to continue participating.");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await acceptCurrentConsent();
    if (!result.ok) setError(result.message);
    setSaving(false);
  };

  const confirmDelete = (): void => {
    Alert.alert(
      "Leave the study and delete everything?",
      "This permanently removes your account, check-ins, research rows, and queued entries. It cannot be undone.",
      [
        { text: "Keep account", style: "cancel" },
        {
          text: "Delete everything",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setDeleting(true);
              const result = await deleteAccount();
              if (!result.ok) setError(result.message);
              setDeleting(false);
            })();
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>CONSENT INTRADAY + CYCLE V2</Text>
        <Text style={styles.title}>Review how participation works.</Text>
        <Text style={styles.subtitle}>
          Research contribution is now required while you use the private forecasting study.
        </Text>
      </View>

      <Notice text="Your existing pseudonymous research records remain protected. You can instead delete your account and all associated records." />

      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <View style={styles.toggleCopy}>
            <Text style={styles.toggleTitle}>Operate the forecasting app</Text>
            <Text style={styles.detail}>
              Store encrypted check-ins, daily summaries, and completed six-hour
              health aggregates. Approximate cycle phases may be displayed for
              wellness context but do not change the current forecast.
            </Text>
          </View>
          <Switch
            value={operational}
            onValueChange={setOperational}
            trackColor={{ false: colors.line, true: colors.mineral }}
            thumbColor={colors.white}
          />
        </View>
        <View style={styles.rule} />
        <View style={styles.toggleRow}>
          <View style={styles.toggleCopy}>
            <Text style={styles.toggleTitle}>Continue research participation</Text>
            <Text style={styles.detail}>
              Contribute accepted check-ins plus daily and six-hour health
              aggregates as separate pseudonymous research records. Reported
              bleeding is included; inferred cycle phases are excluded.
            </Text>
          </View>
          <Switch
            value={research}
            onValueChange={setResearch}
            trackColor={{ false: colors.line, true: colors.mineral }}
            thumbColor={colors.white}
          />
        </View>
      </View>

      <Text style={styles.finePrint}>
        Pseudonymous research records exclude names, email, free text, precise
        location, raw sensor samples and timestamps, device and source-app
        identifiers, and absolute calendar dates. Imported summaries include
        ordinary heart-rate aggregates and are retained until disconnection or
        account deletion.
      </Text>
      {!isOnline ? (
        <Notice
          tone="warning"
          text="A secure connection is required to record updated consent or delete the account."
        />
      ) : null}
      {error ? <Notice text={error} tone="warning" /> : null}
      <Button
        label="Accept and continue"
        disabled={!isOnline || !operational || !research}
        loading={saving}
        onPress={() => void accept()}
      />

      <View style={styles.dangerZone}>
        <Text style={styles.dangerTitle}>Leave instead</Text>
        <Text style={styles.detail}>
          Deleting the account is how you withdraw from mandatory research participation.
        </Text>
        <Button
          label="Delete account and records"
          variant="danger"
          disabled={!isOnline}
          loading={deleting}
          onPress={confirmDelete}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: 8,
    paddingTop: 10,
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
    backgroundColor: colors.amberSoft,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: "#E9D29F",
    padding: 18,
    gap: 16,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  toggleCopy: {
    flex: 1,
    gap: 5,
  },
  toggleTitle: {
    color: colors.ink,
    fontFamily: type.body,
    fontSize: 15,
    fontWeight: "700",
  },
  detail: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 12,
    lineHeight: 18,
  },
  rule: {
    height: 1,
    backgroundColor: "#E9D29F",
  },
  finePrint: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 11,
    lineHeight: 17,
    paddingHorizontal: 4,
  },
  dangerZone: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.large,
    padding: 18,
    gap: 12,
    marginTop: 8,
  },
  dangerTitle: {
    color: colors.danger,
    fontFamily: type.display,
    fontSize: 21,
    fontWeight: "600",
  },
});
