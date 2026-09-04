/**
 * lib/biometrics.ts — real fingerprint/Face ID login, per Prompt 18's
 * explicit "biometric app login in addition to MFA" requirement.
 *
 * WHY this is "in addition to MFA," not instead of it: biometrics
 * unlock the APP on this specific device (a convenience layer over an
 * already-logged-in session) — they don't replace the platform-wide
 * MFA requirement (identity.services.require_mfa_for_sensitive_action)
 * enforced server-side for actually listing a property or paying for
 * a booking. A fingerprint gets you into the app faster; it doesn't
 * bypass the backend's own security rules.
 */
import * as LocalAuthentication from "expo-local-authentication";

export interface BiometricCheckResult {
  available: boolean;
  reason?: string;
}

/** Checks whether this device even supports biometrics and has them
 * enrolled — must be checked before ever showing a "use Face ID" option,
 * since offering it on a device with no fingerprint/face enrolled would
 * just be a broken button. */
export async function checkBiometricAvailability(): Promise<BiometricCheckResult> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) return { available: false, reason: "This device has no biometric hardware." };

  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  if (!isEnrolled) return { available: false, reason: "No fingerprint or face is enrolled on this device." };

  return { available: true };
}

/** Prompts the real OS biometric dialog and returns whether the user
 * was actually authenticated — not a stub that always returns true. */
export async function authenticateWithBiometrics(): Promise<boolean> {
  const { available } = await checkBiometricAvailability();
  if (!available) return false;

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock Oaziland",
    fallbackLabel: "Use password instead",
  });
  return result.success;
}
