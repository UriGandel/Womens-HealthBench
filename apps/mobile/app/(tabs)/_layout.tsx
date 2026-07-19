import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

import { colors, type } from "@/theme";

export default function TabsLayout(): React.ReactElement {
  return (
    <Tabs
      initialRouteName="index"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.mineralDark,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: {
          fontFamily: type.body,
          fontSize: 11,
          fontWeight: "700",
        },
        tabBarStyle: {
          backgroundColor: colors.paper,
          borderTopColor: colors.line,
          height: 82,
          paddingTop: 8,
          paddingBottom: 16,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Tomorrow",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="partly-sunny-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="check-in"
        options={{
          title: "Check in",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="privacy"
        options={{
          title: "Your data",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="shield-checkmark-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
