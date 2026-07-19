import { StyleSheet, Text, View } from "react-native";

import { colors, radius, type } from "@/theme";

interface NoticeProps {
  readonly text: string;
  readonly tone?: "neutral" | "warning";
}

export function Notice({ text, tone = "neutral" }: NoticeProps): React.ReactElement {
  return (
    <View style={[styles.notice, tone === "warning" && styles.warning]}>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    backgroundColor: colors.mineralSoft,
    borderRadius: radius.medium,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderLeftWidth: 3,
    borderLeftColor: colors.mineral,
  },
  warning: {
    backgroundColor: colors.amberSoft,
    borderLeftColor: colors.amber,
  },
  text: {
    color: colors.ink,
    fontFamily: type.body,
    fontSize: 13,
    lineHeight: 19,
  },
});
