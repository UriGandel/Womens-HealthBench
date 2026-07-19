import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, type } from "@/theme";
import type { Rating } from "@/types";

const RATINGS: ReadonlyArray<Rating> = [0, 1, 2, 3, 4];

interface RatingScaleProps {
  readonly label: string;
  readonly value: Rating;
  readonly onChange: (value: Rating) => void;
  readonly lowLabel?: string;
  readonly highLabel?: string;
}

export function RatingScale({
  label,
  value,
  onChange,
  lowLabel = "None",
  highLabel = "Severe",
}: RatingScaleProps): React.ReactElement {
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        {RATINGS.map((rating) => (
          <Pressable
            key={rating}
            accessibilityLabel={`${label}: ${rating} of 4`}
            accessibilityRole="button"
            accessibilityState={{ selected: value === rating }}
            onPress={() => onChange(rating)}
            style={[styles.choice, value === rating && styles.selected]}
          >
            <Text style={[styles.number, value === rating && styles.selectedNumber]}>
              {rating}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.endLabels}>
        <Text style={styles.hint}>{lowLabel}</Text>
        <Text style={styles.hint}>{highLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: 10,
  },
  label: {
    color: colors.ink,
    fontFamily: type.body,
    fontSize: 16,
    fontWeight: "700",
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  choice: {
    flex: 1,
    aspectRatio: 1.15,
    borderRadius: radius.small,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  selected: {
    backgroundColor: colors.mineralDark,
    borderColor: colors.mineralDark,
  },
  number: {
    color: colors.slate,
    fontFamily: type.mono,
    fontSize: 16,
    fontWeight: "700",
  },
  selectedNumber: {
    color: colors.white,
  },
  endLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  hint: {
    color: colors.muted,
    fontFamily: type.body,
    fontSize: 11,
  },
});
