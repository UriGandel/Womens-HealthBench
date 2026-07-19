import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Screen } from "@/components/Screen";
import {
  getHealthAvailability,
  openHealthSettings,
} from "@/services/healthData";
import { useApp } from "@/providers/AppProvider";
import { colors, radius, type } from "@/theme";

const METRICS = [
  "Sleep duration",
  "Steps",
  "Exercise minutes",
  "Active energy",
  "Resting heart rate",
  "Ordinary heart rate (six-hour average, minimum, and maximum)",
  "Heart-rate variability",
  "Respiratory rate",
  "Blood oxygen",
  "Wrist or skin temperature trend",
] as const;

function formatSyncTime(value: string | null | undefined): string {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not synced yet"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

export default function HealthDataScreen(): React.ReactElement {
  const {
    account,
    connectHealth,
    disconnectHealth,
    isHealthSyncing,
    isOnline,
    syncHealth,
    wearablePendingCount,
  } = useApp();
  const router = useRouter();
  const availability = useMemo(getHealthAvailability, []);
  const [message, setMessage] = useState<string | null>(null);
  const connected = account?.wearable_connected ?? false;

  const connect = async (): Promise<void> => {
    setMessage(null);
    const result = await connectHealth();
    setMessage(
      result.ok
        ? "Health data connected. Available daily and completed six-hour summaries were imported."
        : result.message,
    );
  };

  const sync = async (): Promise<void> => {
    setMessage(null);
    const result = await syncHealth();
    setMessage(
      result.ok
        ? isOnline
          ? "Health data is up to date."
          : "Health data is encrypted on this device and will upload when online."
        : result.message,
    );
  };

  const confirmDisconnect = (): void => {
    Alert.alert(
      "Disconnect and delete imported data?",
      "This deletes imported wearable summaries from this device, the service, and the research dataset. Manual check-ins remain.",
      [
        { text: "Keep connected", style: "cancel" },
        {
          text: "Disconnect and delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setMessage(null);
              const result = await disconnectHealth();
              if (result.ok) {
                setMessage(
                  "Imported health data was deleted. Revoke read permission in system settings to finish disconnecting.",
                );
                await openHealthSettings();
              } else {
                setMessage(result.message);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to your data"
        onPress={() => router.back()}
        style={styles.back}
      >
        <Ionicons name="chevron-back" size={18} color={colors.mineralDark} />
        <Text style={styles.backText}>Your data</Text>
      </Pressable>

      <View style={styles.header}>
        <Text style={styles.eyebrow}>READ-ONLY HEALTH CONNECTION</Text>
        <Text style={styles.title}>Signals through your day.</Text>
        <Text style={styles.subtitle}>
          Import up to 31 days of daily summaries and completed six-hour
          aggregates. Raw samples and timestamps, routes, device identifiers,
          and source-app identifiers never leave the health store.
        </Text>
      </View>

      {!availability.available ? (
        <Notice
          tone="warning"
          text={
            availability.needsInstallOrUpdate
              ? "Health Connect must be installed or updated before connecting."
              : Platform.OS === "web"
                ? "Health-app imports are not available in a browser. The rest of the app can still be tested here."
                : "Health data is unavailable in this build or on this device. Use an iOS or Android development build."
          }
        />
      ) : null}
      {wearablePendingCount > 0 ? (
        <Notice
          text={`${wearablePendingCount} encrypted health ${wearablePendingCount === 1 ? "batch is" : "batches are"} waiting to upload.`}
        />
      ) : null}
      {message ? <Notice text={message} /> : null}

      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, connected && styles.dotConnected]} />
          <View style={styles.statusCopy}>
            <Text style={styles.statusTitle}>
              {connected ? "Imported history" : "Not connected"}
            </Text>
            <Text style={styles.statusDetail}>
              {connected
                ? `${account?.wearable_day_count ?? 0} days · ${account?.wearable_interval_count ?? 0} completed six-hour summaries · Last sync ${formatSyncTime(account?.wearable_last_synced_at)}`
                : availability.platform === "apple_health"
                  ? "Apple Health"
                  : "Android Health Connect"}
            </Text>
          </View>
          {connected ? <Text style={styles.dayCount}>CONNECTED</Text> : null}
        </View>
        {!connected ? (
          <Button
            label="Review permissions and connect"
            disabled={!availability.available}
            loading={isHealthSyncing}
            onPress={() => void connect()}
          />
        ) : (
          <Button
            label="Sync now"
            variant="secondary"
            loading={isHealthSyncing}
            onPress={() => void sync()}
          />
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>SUPPORTED HEALTH SUMMARIES</Text>
        {METRICS.map((metric) => (
          <View key={metric} style={styles.metricRow}>
            <Ionicons name="checkmark-circle-outline" size={18} color={colors.mineral} />
            <Text style={styles.metricText}>{metric}</Text>
          </View>
        ))}
        <Text style={styles.finePrint}>
          Permission is granular. A blank metric can mean no measurement, limited
          history, an unsupported sensor, or permission not granted; it is never
          converted to zero. Sleep, resting heart rate, and temperature stay
          daily; activity and other heart-health signals also use four completed
          six-hour buckets.
        </Text>
      </View>

      {connected ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>SYSTEM PERMISSIONS</Text>
          <Text style={styles.detail}>
            You can review or revoke health-store permissions in system settings.
            Revoking access stops future reads but does not delete already imported
            summaries.
          </Text>
          <Button
            label="Open health settings"
            variant="secondary"
            onPress={() => void openHealthSettings()}
          />
        </View>
      ) : null}

      {connected ? (
        <View style={styles.dangerZone}>
          <Text style={styles.dangerTitle}>Disconnect and delete imports</Text>
          <Text style={styles.detail}>
            Remove wearable summaries while keeping your account and manual check-ins.
          </Text>
          <Button
            label="Disconnect and delete health data"
            variant="danger"
            disabled={!isOnline}
            loading={isHealthSyncing}
            onPress={confirmDisconnect}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 40,
  },
  backText: {
    color: colors.mineralDark,
    fontFamily: type.body,
    fontSize: 13,
    fontWeight: "700",
  },
  header: {
    gap: 8,
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
    fontSize: 38,
    lineHeight: 43,
    fontWeight: "600",
    letterSpacing: -0.8,
  },
  subtitle: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 14,
    lineHeight: 21,
  },
  statusCard: {
    backgroundColor: colors.white,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
    gap: 16,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.muted,
  },
  dotConnected: {
    backgroundColor: colors.mineral,
  },
  statusCopy: {
    flex: 1,
    gap: 2,
  },
  statusTitle: {
    color: colors.ink,
    fontFamily: type.display,
    fontSize: 20,
    fontWeight: "600",
  },
  statusDetail: {
    color: colors.muted,
    fontFamily: type.body,
    fontSize: 11,
  },
  dayCount: {
    color: colors.mineralDark,
    fontFamily: type.mono,
    fontSize: 10,
    fontWeight: "700",
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.large,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
    gap: 12,
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
    gap: 9,
  },
  metricText: {
    color: colors.ink,
    fontFamily: type.body,
    fontSize: 14,
  },
  detail: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 12,
    lineHeight: 18,
  },
  finePrint: {
    color: colors.muted,
    fontFamily: type.body,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 4,
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
