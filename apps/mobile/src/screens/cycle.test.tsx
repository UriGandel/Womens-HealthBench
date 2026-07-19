import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

import CycleScreen from "../../app/(tabs)/cycle";
import { useApp } from "@/providers/AppProvider";
import { localDateString } from "@/utils/date";

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
  const Native = require("react-native") as typeof import("react-native");
  return {
    Notice: ({ text }: { readonly text: string }) =>
      React.createElement(Native.Text, null, text),
  };
});
jest.mock("@/components/Button", () => {
  const React = require("react") as typeof import("react");
  const Native = require("react-native") as typeof import("react-native");
  return {
    Button: ({
      label,
      onPress,
      disabled,
    }: {
      readonly label: string;
      readonly onPress: () => void;
      readonly disabled?: boolean;
    }) =>
      React.createElement(
        Native.Pressable,
        { onPress, disabled },
        React.createElement(Native.Text, null, label),
      ),
  };
});
jest.mock("@/providers/AppProvider", () => ({
  useApp: jest.fn(),
}));

const enableCycleTracking =
  jest.fn<() => Promise<{ ok: true; value: undefined }>>();
const logCycleDay =
  jest.fn<
    (
      observedDate: string,
      status: "spotting" | "flow" | null,
    ) => Promise<{ ok: true; value: undefined }>
  >();

beforeEach(() => {
  jest.clearAllMocks();
  enableCycleTracking.mockResolvedValue({ ok: true, value: undefined });
  logCycleDay.mockResolvedValue({ ok: true, value: undefined });
});

test("requires explicit online enablement and explains the boundary", async () => {
  jest.mocked(useApp).mockReturnValue({
    cycleSummary: null,
    cyclePendingCount: 0,
    cycleSyncIssue: null,
    isOnline: true,
    enableCycleTracking,
    logCycleDay,
  } as unknown as ReturnType<typeof useApp>);

  const screen = await render(<CycleScreen />);
  expect(screen.getByText("What this does not do")).toBeTruthy();
  expect(screen.getByText(/does not estimate fertility/)).toBeTruthy();
  await fireEvent.press(screen.getByText("Enable cycle tracking"));
  await waitFor(() => expect(enableCycleTracking).toHaveBeenCalledTimes(1));
});

test("logs the selected day and exposes selected accessibility state", async () => {
  const today = localDateString();
  jest.mocked(useApp).mockReturnValue({
    cycleSummary: {
      enabled: true,
      days: [{ observed_date: today, period_status: "flow" }],
      current_cycle_day: 1,
      cycle_started_on: today,
      observed_cycle_length_days: null,
      cycle_start_count: 1,
      pattern_status: "insufficient_data",
      patterns: [],
    },
    cyclePendingCount: 0,
    cycleSyncIssue: null,
    isOnline: true,
    enableCycleTracking,
    logCycleDay,
  } as unknown as ReturnType<typeof useApp>);

  const screen = await render(<CycleScreen />);
  expect(screen.getByText("Cycle day 1")).toBeTruthy();
  const flow = screen
    .getAllByText("Flow")
    .map((item) => item.parent)
    .find((item) => item?.props.accessibilityState?.selected === true);
  expect(flow?.props.accessibilityState).toMatchObject({ selected: true });
  const spotting = screen
    .getAllByText("Spotting")
    .map((item) => item.parent)
    .find((item) => typeof item?.props.accessibilityState?.selected === "boolean");
  if (!spotting) throw new Error("Spotting status control was not rendered");
  await fireEvent.press(spotting);
  await waitFor(() => expect(logCycleDay).toHaveBeenCalledWith(today, "spotting"));
});
