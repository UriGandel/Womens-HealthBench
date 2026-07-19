import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

import CheckInScreen from "../../app/(tabs)/check-in";
import { useApp } from "@/providers/AppProvider";
import type { CheckInCreate } from "@/types";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));
jest.mock("expo-crypto", () => ({
  randomUUID: () => "check-in-cycle-uuid",
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
    }: {
      readonly label: string;
      readonly onPress: () => void;
    }) =>
      React.createElement(
        Native.Pressable,
        { onPress },
        React.createElement(Native.Text, null, label),
      ),
  };
});
jest.mock("@/components/RatingScale", () => {
  const React = require("react") as typeof import("react");
  const Native = require("react-native") as typeof import("react-native");
  return {
    RatingScale: ({
      label,
      onChange,
    }: {
      readonly label: string;
      readonly onChange: (value: 1) => void;
    }) =>
      React.createElement(
        Native.Pressable,
        { accessibilityLabel: `Set ${label}`, onPress: () => onChange(1) },
        React.createElement(Native.Text, null, label),
      ),
  };
});
jest.mock("@/providers/AppProvider", () => ({
  useApp: jest.fn(),
}));

const submitCheckIn =
  jest.fn<(payload: CheckInCreate) => Promise<{ ok: true; value: undefined }>>();
const logCycleDay =
  jest.fn<
    (
      observedDate: string,
      status: "spotting" | "flow" | null,
    ) => Promise<{ ok: true; value: undefined }>
  >();
const cycleContextForDate =
  jest.fn<
    (
      observedDate: string,
    ) => Promise<{
      readonly period_status: "none" | "spotting" | "flow";
      readonly cycle_day: number | null;
    }>
  >();
const wearableSleepHours =
  jest.fn<(observedDate: string) => Promise<number | null>>();

async function completeRatings(
  screen: Awaited<ReturnType<typeof render>>,
): Promise<void> {
  for (const label of [
    "Sleep quality",
    "Stress",
    "Fatigue",
    "Brain fog",
    "Headache or migraine",
    "Pelvic pain",
    "Mood disruption",
  ]) {
    await fireEvent.press(screen.getByLabelText(`Set ${label}`));
  }
  await fireEvent.changeText(screen.getByLabelText("Hours of sleep"), "7");
}

beforeEach(() => {
  jest.clearAllMocks();
  submitCheckIn.mockResolvedValue({ ok: true, value: undefined });
  logCycleDay.mockResolvedValue({ ok: true, value: undefined });
  wearableSleepHours.mockResolvedValue(null);
});

test("requires a bleeding answer even when cycle-history editing is disabled", async () => {
  cycleContextForDate.mockResolvedValue({
    period_status: "none",
    cycle_day: null,
  });
  jest.mocked(useApp).mockReturnValue({
    submitCheckIn,
    isOnline: true,
    pendingCount: 0,
    syncIssue: null,
    wearableSleepHours,
    cycleSummary: { enabled: false },
    cycleContextForDate,
    logCycleDay,
  } as unknown as ReturnType<typeof useApp>);

  const screen = await render(<CheckInScreen />);
  expect(screen.getByText("Cycle context")).toBeTruthy();
  await completeRatings(screen);
  await fireEvent.press(screen.getByText("Save today’s check-in"));
  expect(
    screen.getByText("Choose None, Spotting, or Flow for today’s bleeding."),
  ).toBeTruthy();
  expect(submitCheckIn).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByLabelText("Today’s bleeding: Spotting"));
  await fireEvent.press(screen.getByText("Save today’s check-in"));

  await waitFor(() => expect(submitCheckIn).toHaveBeenCalledTimes(1));
  expect(submitCheckIn.mock.calls[0]?.[0]).toEqual(
    expect.objectContaining({
      period_status: "spotting",
      cycle_day: null,
    }),
  );
  expect(logCycleDay).not.toHaveBeenCalled();
});

test("starts bleeding unselected and writes the deliberate answer to history", async () => {
  cycleContextForDate.mockResolvedValue({
    period_status: "flow",
    cycle_day: 2,
  });
  jest.mocked(useApp).mockReturnValue({
    submitCheckIn,
    isOnline: true,
    pendingCount: 0,
    syncIssue: null,
    wearableSleepHours,
    cycleSummary: { enabled: true },
    cycleContextForDate,
    logCycleDay,
  } as unknown as ReturnType<typeof useApp>);

  const screen = await render(<CheckInScreen />);
  await waitFor(() =>
    expect(screen.getByText("AUTOMATICALLY CALCULATED · CYCLE DAY 2")).toBeTruthy(),
  );
  expect(
    screen.getByLabelText("Today’s bleeding: Flow").props.accessibilityState,
  ).toMatchObject({ selected: false });
  await completeRatings(screen);
  await fireEvent.press(screen.getByLabelText("Today’s bleeding: Flow"));
  await fireEvent.press(screen.getByText("Save today’s check-in"));

  await waitFor(() => expect(logCycleDay).toHaveBeenCalledWith(expect.any(String), "flow"));
  await waitFor(() => expect(submitCheckIn).toHaveBeenCalledTimes(1));
  expect(submitCheckIn.mock.calls[0]?.[0]).toEqual(
    expect.objectContaining({
      period_status: "flow",
      cycle_day: 2,
    }),
  );
});

test("refreshes calculated cycle day without silently selecting bleeding", async () => {
  cycleContextForDate
    .mockResolvedValueOnce({ period_status: "flow", cycle_day: 1 })
    .mockResolvedValueOnce({ period_status: "spotting", cycle_day: 5 });
  const baseContext = {
    submitCheckIn,
    isOnline: true,
    pendingCount: 0,
    syncIssue: null,
    wearableSleepHours,
    cycleContextForDate,
    logCycleDay,
  };
  jest.mocked(useApp).mockReturnValue({
    ...baseContext,
    cycleSummary: {
      enabled: true,
      days: [{ observed_date: "2026-07-19", period_status: "flow" }],
    },
  } as unknown as ReturnType<typeof useApp>);

  const screen = await render(<CheckInScreen />);
  await waitFor(() =>
    expect(screen.getByText("AUTOMATICALLY CALCULATED · CYCLE DAY 1")).toBeTruthy(),
  );

  jest.mocked(useApp).mockReturnValue({
    ...baseContext,
    cycleSummary: {
      enabled: true,
      days: [{ observed_date: "2026-07-19", period_status: "spotting" }],
    },
  } as unknown as ReturnType<typeof useApp>);
  await screen.rerender(<CheckInScreen />);

  await waitFor(() =>
    expect(screen.getByText("AUTOMATICALLY CALCULATED · CYCLE DAY 5")).toBeTruthy(),
  );
  const spotting = screen.getByLabelText("Today’s bleeding: Spotting");
  expect(spotting?.props.accessibilityState).toMatchObject({ selected: false });
});
