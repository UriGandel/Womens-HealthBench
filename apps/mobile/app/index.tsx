import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { Notice } from "@/components/Notice";
import { useApp } from "@/providers/AppProvider";
import { colors, type } from "@/theme";

export default function IndexScreen(): React.ReactElement {
  const { token, isBooting, storageError } = useApp();
  if (isBooting) {
    return (
      <View style={styles.center}>
        <View style={styles.mark}>
          <View style={styles.markCore} />
        </View>
        <Text style={styles.wordmark}>Tomorrow, gently</Text>
        <ActivityIndicator color={colors.mineral} />
      </View>
    );
  }
  if (storageError) {
    return (
      <View style={styles.error}>
        <Text style={styles.wordmark}>Encrypted storage needs attention</Text>
        <Notice text={storageError} tone="warning" />
      </View>
    );
  }
  return <Redirect href={token ? "/lock" : "/enroll"} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    backgroundColor: colors.fog,
  },
  error: {
    flex: 1,
    justifyContent: "center",
    padding: 28,
    gap: 20,
    backgroundColor: colors.fog,
  },
  mark: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 2,
    borderColor: colors.mineral,
    alignItems: "center",
    justifyContent: "center",
  },
  markCore: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.amber,
  },
  wordmark: {
    color: colors.ink,
    fontFamily: type.display,
    fontSize: 27,
    fontWeight: "600",
  },
});
