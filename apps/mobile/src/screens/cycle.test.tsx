import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

import CycleScreen from "../../app/(tabs)/cycle";
import { useApp } from "@/providers/AppProvider";
import type {
  CycleTrackingSummary,
  PhaseForecastResponse,
} from "@/types";
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

function readyCycleSummary(
  today: string,
  phase: "menstrual" | "follicular" | "ovulatory" | "luteal" = "menstrual",
): CycleTrackingSummary {
  return {
    enabled: true,
    days: [{ observed_date: today, period_status: "flow" }],
    current_cycle_day: 1,
    cycle_started_on: today,
    observed_cycle_length_days: 28,
    cycle_start_count: 3,
    pattern_status: "ready",
    patterns: [],
    prediction_status: "ready",
    prediction_confidence: "medium",
    projected_through: "2026-09-19",
    predicted_period_windows: [
      {
        start_date: "2026-08-15",
        end_date: "2026-08-19",
        confidence: "medium",
      },
    ],
    phase_days: [
      {
        observed_date: today,
        phase,
        predicted: false,
        confidence: "high",
      },
      {
        observed_date: "2026-07-30",
        phase: "ovulatory",
        predicted: true,
        confidence: "medium",
      },
    ],
  };
}

function mockCycleApp(
  cycleSummary: CycleTrackingSummary | null,
  phaseForecast: PhaseForecastResponse | null,
): void {
  jest.mocked(useApp).mockReturnValue({
    cycleSummary,
    phaseForecast,
    cyclePendingCount: 0,
    cycleSyncIssue: null,
    isOnline: true,
    enableCycleTracking,
    logCycleDay,
  } as unknown as ReturnType<typeof useApp>);
}

test("keeps the calendar visible while history editing is disabled", async () => {
  mockCycleApp(null, null);

  const screen = await render(<CycleScreen />);
  expect(screen.getByText("Estimated phases")).toBeTruthy();
  expect(screen.getByText(/not medical advice, fertility guidance/)).toBeTruthy();
  await fireEvent.press(screen.getByText("Enable history editing"));
  await waitFor(() => expect(enableCycleTracking).toHaveBeenCalledTimes(1));
});

test("logs the selected day and exposes selected accessibility state", async () => {
  const today = localDateString();
  mockCycleApp(readyCycleSummary(today), null);

  const screen = await render(<CycleScreen />);
  expect(screen.getByText("Cycle day 1")).toBeTruthy();
  expect(screen.getByText(/Predicted period 1/)).toBeTruthy();
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

test("combines an agreeing wearable label with the existing rule estimate", async () => {
  const today = localDateString();
  mockCycleApp(readyCycleSummary(today, "luteal"), {
    status: "ready",
    predicted_phase: "Luteal",
    model_version: "mcphases-app-common-0.2.0",
    usable_days: 7,
    required_days: 4,
    lookback_days: 7,
    disclaimer: "Research estimate only.",
  });

  const screen = await render(<CycleScreen />);

  expect(screen.getByText("WEARABLE MODEL · TODAY")).toBeTruthy();
  expect(screen.getByText("CALENDAR RULES · FUTURE")).toBeTruthy();
  expect(screen.getByText("Today’s research dataset label")).toBeTruthy();
  expect(
    screen.getByText(/point in the same direction today/),
  ).toBeTruthy();
  expect(screen.getByText(/Predicted period 1/)).toBeTruthy();
  expect(screen.getByText(/Estimated ovulatory range/)).toBeTruthy();
});

test("shows disagreement and never turns Fertility into a personal claim", async () => {
  const today = localDateString();
  mockCycleApp(readyCycleSummary(today, "menstrual"), {
    status: "ready",
    predicted_phase: "Fertility",
    model_version: "mcphases-app-common-0.2.0",
    usable_days: 6,
    required_days: 4,
    lookback_days: 7,
    disclaimer:
      "Research estimate only—not medical advice, fertility guidance, contraception guidance, ovulation confirmation, or diagnosis.",
  });

  const screen = await render(<CycleScreen />);

  expect(screen.getByText(/rule differ today/)).toBeTruthy();
  expect(screen.getByText(/source dataset’s phase label/)).toBeTruthy();
  expect(screen.getByText(/does not mean that you are fertile/)).toBeTruthy();
  expect(screen.queryByText("You are fertile")).toBeNull();
  expect(screen.getByText(/Predicted period 1/)).toBeTruthy();
});

test.each([
  {
    status: "insufficient_data" as const,
    predicted_phase: null,
    usable_days: 3,
    expected: /currently has 3\/4/,
  },
  {
    status: "model_unavailable" as const,
    predicted_phase: null,
    usable_days: 0,
    expected: /temporarily unavailable/,
  },
])(
  "keeps calendar-rule projections when the model is $status",
  async ({ status, predicted_phase, usable_days, expected }) => {
    const today = localDateString();
    mockCycleApp(readyCycleSummary(today), {
      status,
      predicted_phase,
      model_version: "mcphases-app-common-0.2.0",
      usable_days,
      required_days: 4,
      lookback_days: 7,
      disclaimer: "Research estimate only.",
    });

    const screen = await render(<CycleScreen />);

    expect(screen.getByText(expected)).toBeTruthy();
    expect(screen.getByText(/Predicted period 1/)).toBeTruthy();
    expect(screen.getByText(/Estimated ovulatory range/)).toBeTruthy();
  },
);
