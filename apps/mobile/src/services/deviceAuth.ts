import * as LocalAuthentication from "expo-local-authentication";

import type { Result } from "@/types";

export async function authenticateDevice(): Promise<Result<void>> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) {
      return {
        ok: false,
        message:
          "Set a device passcode, Face ID, or fingerprint in system settings before using this private app.",
      };
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock Tomorrow, Gently",
      promptSubtitle: "Protect your private health check-ins",
      fallbackLabel: "Use device passcode",
      cancelLabel: "Not now",
      disableDeviceFallback: false,
    });
    if (result.success) return { ok: true, value: undefined };

    const unavailable = new Set([
      "not_available",
      "not_enrolled",
      "passcode_not_set",
    ]);
    return {
      ok: false,
      message: unavailable.has(result.error)
        ? "Device authentication is not configured. Add a passcode or biometric in system settings, then try again."
        : "The app stayed locked. Authenticate with your device to continue.",
    };
  } catch {
    return {
      ok: false,
      message: "Device authentication could not start. Check system settings and try again.",
    };
  }
}
