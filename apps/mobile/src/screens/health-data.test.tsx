import { beforeEach, expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";

import HealthDataScreen from "../../app/health-data";
import { useApp } from "@/providers/AppProvider";
import { openHealthSettings } from "@/services/healthData";

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: jest.fn() }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));
jest.mock("@/components/Screen", () => {
  const React = require("react") as typeof import("react");
  return {
    Screen: ({ children }: import("react").PropsWithChildren) =>
      React.createElement(React.Fragment, null, children),
  };
});
jest.mock("@/components/Notice", () => {
  const React = require("react") as typeof import("react");
  const { Text } = require("react-native") as typeof import("react-native");
  return {
    Notice: ({ text }: { readonly text: string }) =>
      React.createElement(Text, null, text),
  };
});
jest.mock("@/components/Button", () => {
  const React = require("react") as typeof import("react");
  const { Pressable, Text } =
    require("react-native") as typeof import("react-native");
  return {
    Button: ({
      label,
      onPress,
    }: {
      readonly label: string;
      readonly onPress: () => void;
    }) =>
      React.createElement(
        Pressable,
        { onPress },
        React.createElement(Text, null, label),
      ),
  };
});
jest.mock("@/providers/AppProvider", () => ({
  useApp: jest.fn(),
}));
jest.mock("@/services/healthData", () => ({
  getHealthAvailability: () => ({
    available: true,
    needsInstallOrUpdate: false,
    platform: "apple_health",
  }),
  openHealthSettings: jest.fn(),
}));

const disconnectHealth = jest.fn<() => Promise<{ ok: true; value: undefined }>>();
let confirmDestructiveAction: (() => void) | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  confirmDestructiveAction = undefined;
  disconnectHealth.mockResolvedValue({ ok: true, value: undefined });
  jest.mocked(useApp).mockReturnValue({
    account: {
      consent_current: true,
      consent_version: "2026-07-19-intraday-cycle-v2",
      checkin_count: 4,
      research_record_count: 6,
      wearable_connected: true,
      wearable_platform: "apple_health",
      wearable_day_count: 3,
      wearable_interval_count: 8,
      wearable_last_synced_at: "2026-07-19T12:00:00Z",
      cycle_tracking_enabled: false,
      cycle_day_count: 0,
    },
    connectHealth: jest.fn(),
    disconnectHealth,
    isHealthSyncing: false,
    isOnline: true,
    syncHealth: jest.fn(),
    wearablePendingCount: 0,
  } as unknown as ReturnType<typeof useApp>);
  jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
    const destructive = buttons?.find((button) => button.style === "destructive");
    confirmDestructiveAction = destructive?.onPress;
  });
});

test("disconnect deletes imported data and then opens permission settings", async () => {
  const screen = await render(<HealthDataScreen />);

  await fireEvent.press(screen.getByText("Disconnect and delete health data"));
  await act(async () => {
    confirmDestructiveAction?.();
    await Promise.resolve();
  });

  await waitFor(() => expect(disconnectHealth).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(openHealthSettings).toHaveBeenCalledTimes(1));
  expect(
    screen.getByText(/Imported health data was deleted/),
  ).toBeTruthy();
});
