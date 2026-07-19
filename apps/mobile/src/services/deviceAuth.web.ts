import type { Result } from "@/types";

/**
 * Browser preview builds cannot invoke the device passcode or biometric prompt.
 * Native builds resolve the sibling `deviceAuth.ts` implementation instead.
 */
export async function authenticateDevice(): Promise<Result<void>> {
  return { ok: true, value: undefined };
}
