import { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { setupMfa, verifyMfa, getMfaStatus } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "MfaSetup">;

/**
 * MFA setup — the mobile equivalent of a critical fix made earlier
 * this session: the backend MFA setup/verify endpoints existed with
 * NO way for a real user to complete them on any client. Same real
 * flow as web: choose a method, receive a real code, verify it.
 */
export default function MfaSetupScreen({ navigation }: Props) {
  const [alreadyEnabled, setAlreadyEnabled] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [mfaType, setMfaType] = useState<"SMS_OTP" | "EMAIL_OTP">("SMS_OTP");
  const [destination, setDestination] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getMfaStatus()
      .then((status) => setAlreadyEnabled(status.mfa_enabled))
      .catch(() => {})
      .finally(() => setCheckingStatus(false));
  }, []);

  async function handleSendCode() {
    setError("");
    setLoading(true);
    try {
      const result = await setupMfa(mfaType, destination);
      setChallengeId(result.challenge_id);
    } catch {
      setError("Could not send the code. Please check the details and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    if (!challengeId) return;
    setError("");
    setLoading(true);
    try {
      await verifyMfa(challengeId, code);
      setSuccess(true);
    } catch {
      setError("Incorrect or expired code. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (checkingStatus) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#1B2A4A" size="large" />
      </View>
    );
  }

  if (alreadyEnabled || success) {
    return (
      <View style={styles.centered}>
        <Text style={styles.successText}>
          ✓ {success ? "Two-factor authentication is now enabled on your account." : "Two-factor authentication is already enabled on your account."}
        </Text>
        <TouchableOpacity style={styles.continueButton} onPress={() => navigation.navigate("ListProperty")}>
          <Text style={styles.continueButtonText}>Continue to List a Property</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Set Up Two-Factor Authentication</Text>
      <Text style={styles.subtitle}>Required before you can list a property or make a booking — this keeps your account secure.</Text>

      {!challengeId ? (
        <>
          <Text style={styles.label}>How should we send your verification code?</Text>
          <View style={styles.toggleRow}>
            {(["SMS_OTP", "EMAIL_OTP"] as const).map((type) => (
              <TouchableOpacity
                key={type}
                style={[styles.toggle, mfaType === type && styles.toggleSelected]}
                onPress={() => setMfaType(type)}
              >
                <Text style={[styles.toggleText, mfaType === type && styles.toggleTextSelected]}>
                  {type === "SMS_OTP" ? "Text Message (SMS)" : "Email"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.input}
            keyboardType={mfaType === "SMS_OTP" ? "phone-pad" : "email-address"}
            value={destination}
            onChangeText={setDestination}
            placeholder={mfaType === "SMS_OTP" ? "Phone number (+237...)" : "Email address"}
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity style={styles.submitButton} onPress={handleSendCode} disabled={loading || !destination}>
            {loading ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.submitButtonText}>Send Code</Text>}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.label}>Enter the 6-digit code we sent you</Text>
          <TextInput
            style={[styles.input, styles.codeInput]} keyboardType="number-pad" maxLength={6}
            value={code} onChangeText={(text) => setCode(text.replace(/\D/g, ""))} placeholder="123456"
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity style={styles.submitButton} onPress={handleVerify} disabled={loading || code.length < 6}>
            {loading ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.submitButtonText}>Verify</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setChallengeId(null)}>
            <Text style={styles.resendText}>Send a new code</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 20 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  title: { fontSize: 22, fontWeight: "bold", color: "#1B2A4A", marginBottom: 6 },
  subtitle: { fontSize: 13, color: "#6B7280", marginBottom: 24 },
  label: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 10 },
  toggleRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  toggle: { flex: 1, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  toggleSelected: { backgroundColor: "#1B2A4A", borderColor: "#1B2A4A" },
  toggleText: { color: "#374151", fontSize: 13 },
  toggleTextSelected: { color: "#fff", fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 15 },
  codeInput: { textAlign: "center", fontSize: 24, letterSpacing: 8 },
  errorText: { color: "#DC2626", fontSize: 13, marginBottom: 12 },
  successText: { color: "#15803D", fontSize: 15, fontWeight: "600", textAlign: "center", marginBottom: 20 },
  submitButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  submitButtonText: { color: "#1B2A4A", fontWeight: "bold", fontSize: 16 },
  resendText: { color: "#6B7280", fontSize: 13, textAlign: "center", marginTop: 16 },
  continueButton: { backgroundColor: "#1B2A4A", borderRadius: 8, paddingVertical: 14, paddingHorizontal: 24, alignItems: "center" },
  continueButtonText: { color: "#fff", fontWeight: "bold", fontSize: 15 },
});
