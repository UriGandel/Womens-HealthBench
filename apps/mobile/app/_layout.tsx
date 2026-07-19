import { Lora_600SemiBold, useFonts } from "@expo-google-fonts/lora";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { AppProvider } from "@/providers/AppProvider";
import { colors } from "@/theme";

export default function RootLayout(): React.ReactElement | null {
  const [fontsLoaded] = useFonts({ Lora_600SemiBold });
  if (!fontsLoaded) return null;
  return (
    <AppProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.fog },
          animation: "fade",
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="enroll" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </AppProvider>
  );
}
