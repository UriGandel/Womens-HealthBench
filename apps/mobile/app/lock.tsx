import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Screen } from "@/components/Screen";
import { useApp } from "@/providers/AppProvider";
import { colors, radius, type } from "@/theme";

export default function LockScreen(): React.ReactElement {
  const {
    hasCurrentConsent,
    isLocked,
    isOnline,
    isRefreshing,
    refresh,
    unlockApp,
  } = useApp();
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlock = async (): Promise<void> => {
    setUnlocking(true);
    setError(null);
    const result = await unlockApp();
    if (!result.ok) setError(result.message);
    setUnlocking(false);
  };

  return (
    <Screen scroll={false}>
      <View style={styles.container}>
        <View style={styles.instrument}>
          <View style={styles.ring}>
            <View style={styles.core}>
              <Ionicons name="lock-closed" size={25} color={colors.white} />
            </View>
          </View>
        </View>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>PRIVATE HEALTH RECORD</Text>
          <Text style={styles.title}>Your signal is locked.</Text>
          <Text style={styles.detail}>
            {Platform.OS === "web"
              ? "Continue to this browser preview. Device authentication is only available in native builds."
              : "Use this device’s Face ID, fingerprint, or passcode to continue."}
          </Text>
        </View>
        {error ? <Notice text={error} tone="warning" /> : null}
        {!isLocked && isRefreshing ? (
          <View style={styles.checking}>
            <ActivityIndicator color={colors.mineral} />
            <Text style={styles.checkingText}>Checking participation status…</Text>
          </View>
        ) : !isLocked && hasCurrentConsent === null ? (
          <>
            <Notice
              tone="warning"
              text="Connect securely once to verify the current participation consent on this device."
            />
            <Button
              label="Check participation status"
              disabled={!isOnline}
              onPress={() => void refresh()}
            />
          </>
        ) : (
          <Button
            label={Platform.OS === "web" ? "Continue preview" : "Unlock with this device"}
            loading={unlocking}
            onPress={() => void unlock()}
          />
        )}
        <Text style={styles.finePrint}>
          {Platform.OS === "web"
            ? "Preview data stays in memory and is erased when the page reloads."
            : "Authentication stays on this device. The app never receives biometric data or your device passcode."}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 22,
  },
  instrument: {
    alignItems: "center",
    marginBottom: 8,
  },
  ring: {
    width: 142,
    height: 142,
    borderRadius: 71,
    borderWidth: 12,
    borderColor: colors.mineralSoft,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  core: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: colors.mineralDark,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: {
    alignItems: "center",
    gap: 9,
  },
  eyebrow: {
    color: colors.mineral,
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  title: {
    color: colors.ink,
    fontFamily: type.display,
    fontSize: 36,
    lineHeight: 41,
    fontWeight: "600",
    textAlign: "center",
  },
  detail: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 340,
  },
  checking: {
    minHeight: 54,
    borderRadius: radius.medium,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  checkingText: {
    color: colors.slate,
    fontFamily: type.body,
    fontSize: 14,
  },
  finePrint: {
    color: colors.muted,
    fontFamily: type.body,
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
    paddingHorizontal: 14,
  },
});
