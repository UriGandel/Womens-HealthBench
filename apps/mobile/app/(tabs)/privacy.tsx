import { useState } from "react";
import {
  Alert,
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

export default function PrivacyScreen(): React.ReactElement {
  const {
    account,
    pendingCount,
    isOnline,
    setResearchConsent,
    deleteAccount,
  } = useApp();
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const changeResearchConsent = async (enabled: boolean): Promise<void> => {
    setUpdating(true);
    setMessage(null);
    const result = await setResearchConsent(enabled, enabled);
    setUpdating(false);
    setMessage(
      result.ok
        ? enabled
          ? "Research contribution is on. Existing eligible check-ins were included."
          : "Research contribution is off. Your research rows were withdrawn."
        : result.message,
    );
  };

  const confirmDelete = (): void => {
    Alert.alert(
      "Delete account and records?",
      "This permanently deletes your account, check-ins, research rows, and queued local entries. It cannot be undone.",
      [
        { text: "Keep account", style: "cancel" },
        {
          text: "Delete everything",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setDeleting(true);
              const result = await deleteAccount();
              setDeleting(false);
              if (!result.ok) setMessage(result.message);
            })();
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PRIVACY CONTROL</Text>
        <Text style={styles.title}>Your data stays yours.</Text>
        <Text style={styles.subtitle}>
          App use and research contribution are separate choices.
        </Text>
      </View>

      <View style={styles.researchCard}>
        <View style={styles.toggleRow}>
          <View style={styles.toggleCopy}>
            <Text style={styles.sectionTitle}>Research contribution</Text>
            <Text style={styles.detail}>
              Share pseudonymous, structured daily records with the research dataset.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Research contribution"
            disabled={updating || !isOnline || !account}
            value={account?.research_opt_in ?? false}
            onValueChange={(value) => void changeResearchConsent(value)}
            trackColor={{ false: colors.line, true: colors.mineral }}
            thumbColor={colors.white}
          />
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {account?.research_opt_in ? "OPTED IN" : "NOT CONTRIBUTING"}
          </Text>
        </View>
        <Text style={styles.finePrint}>
          Pseudonymous does not mean anonymous. Turning this off removes contributed research rows while preserving operational check-ins needed for your app.
        </Text>
      </View>

      {!isOnline ? (
        <Notice
          tone="warning"
          text="Privacy changes need a secure connection so the server can confirm them. Try again when you’re online."
        />
      ) : null}
      {message ? <Notice text={message} /> : null}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>YOUR RECORDS</Text>
        <View style={styles.metricRow}>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{account?.checkin_count ?? "—"}</Text>
            <Text style={styles.metricLabel}>Check-ins</Text>
          </View>
          <View style={styles.verticalRule} />
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{account?.research_record_count ?? "—"}</Text>
            <Text style={styles.metricLabel}>Research rows</Text>
          </View>
          <View style={styles.verticalRule} />
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{pendingCount}</Text>
            <Text style={styles.metricLabel}>On device</Text>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>WHAT WE DO NOT COLLECT</Text>
        <Text style={styles.listText}>
          Free text · precise location · contacts · advertising IDs · photos · browsing activity
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>SAFE USE</Text>
        <Text style={styles.listText}>
          Forecasts are experimental wellness information. They are not diagnoses, do not identify causes, and should never delay professional care.
        </Text>
        <Text style={styles.consentVersion}>
          CONSENT VERSION {account?.consent_version ?? "—"}
        </Text>
      </View>

      <View style={styles.dangerZone}>
        <Text style={styles.dangerTitle}>Delete everything</Text>
        <Text style={styles.detail}>
          Permanently delete your account, operational check-ins, research rows, and this device’s queued entries.
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
  researchCard: {
    backgroundColor: colors.amberSoft,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: "#E9D29F",
    padding: 18,
    gap: 14,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
    gap: 14,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  toggleCopy: {
    flex: 1,
    gap: 5,
  },
  sectionTitle: {
    color: colors.ink,
    fontFamily: type.display,
    fontSize: 21,
    fontWeight: "600",
  },
  detail: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 12,
    lineHeight: 18,
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 9,
    backgroundColor: colors.white,
  },
  badgeText: {
    color: colors.plum,
    fontFamily: type.mono,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  finePrint: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 11,
    lineHeight: 17,
  },
  cardLabel: {
    color: colors.mineral,
    fontFamily: type.mono,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  metricRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  metric: {
    flex: 1,
    alignItems: "center",
    gap: 3,
  },
  metricValue: {
    color: colors.ink,
    fontFamily: type.display,
    fontSize: 28,
    fontWeight: "600",
  },
  metricLabel: {
    color: colors.muted,
    fontFamily: type.body,
    fontSize: 10,
  },
  verticalRule: {
    width: 1,
    height: 38,
    backgroundColor: colors.line,
  },
  listText: {
    color: colors.ink,
    fontFamily: type.body,
    fontSize: 14,
    lineHeight: 22,
  },
  consentVersion: {
    color: colors.muted,
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 0.7,
  },
  dangerZone: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: "#E7C6C1",
    padding: 18,
    gap: 12,
  },
  dangerTitle: {
    color: colors.danger,
    fontFamily: type.display,
    fontSize: 21,
    fontWeight: "600",
  },
});
