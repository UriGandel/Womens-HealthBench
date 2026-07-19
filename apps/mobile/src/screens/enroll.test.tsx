import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

import EnrollScreen from "../../app/enroll";
import { useApp } from "@/providers/AppProvider";

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));
jest.mock("@/components/Screen", () => {
  const React = require("react") as typeof import("react");
  return {
    Screen: ({
      children,
      footer,
      header,
    }: import("react").PropsWithChildren<{
      readonly footer?: import("react").ReactNode;
      readonly header?: import("react").ReactNode;
    }>) =>
      React.createElement(
        React.Fragment,
        null,
        header,
        children,
        footer,
      ),
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
}));

const enrollUser = jest.fn<() => Promise<{ ok: true; value: undefined }>>();
const connectHealth = jest.fn<() => Promise<{ ok: true; value: undefined }>>();
const completeEnrollment = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  enrollUser.mockResolvedValue({ ok: true, value: undefined });
  connectHealth.mockResolvedValue({ ok: true, value: undefined });
  jest.mocked(useApp).mockReturnValue({
    completeEnrollment,
    connectHealth,
    enrollUser,
    isHealthSyncing: false,
  } as unknown as ReturnType<typeof useApp>);
});

test("offers Apple Health sync after consent and enrollment", async () => {
  const screen = await render(<EnrollScreen />);

  await fireEvent.press(screen.getByText("I agree"));
  await fireEvent.press(await screen.findByText("Yes"));
  await fireEvent.press(screen.getByText("Enter"));

  await waitFor(() => expect(enrollUser).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("Sync with Apple Health")).toBeTruthy();

  await fireEvent.press(screen.getByText("Connect Apple Health"));

  await waitFor(() => expect(connectHealth).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("Apple Health is connected")).toBeTruthy();

  await fireEvent.press(screen.getByText("Continue to my forecast"));
  expect(completeEnrollment).toHaveBeenCalledTimes(1);
});

test("allows health sync to be skipped", async () => {
  const screen = await render(<EnrollScreen />);

  await fireEvent.press(screen.getByText("I agree"));
  await fireEvent.press(await screen.findByText("Yes"));
  await fireEvent.press(screen.getByText("Enter"));

  await screen.findByText("Skip for now");
  await fireEvent.press(screen.getByText("Skip for now"));

  expect(connectHealth).not.toHaveBeenCalled();
  expect(completeEnrollment).toHaveBeenCalledTimes(1);
});
