import { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { loginUser, completeMfaLogin, MfaRequiredError } from "../lib/api";
import { registerDeviceForPush } from "../lib/pushNotifications";
import { checkBiometricAvailability, authenticateWithBiometrics } from "../lib/biometrics";
import { useI18n } from "../i18n";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;

export default function LoginScreen({ navigation }: Props) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [challenge, setChallenge] = useState<MfaRequiredError | null>(null);
  const [code, setCode] = useState("");

  useEffect(() => {
    checkBiometricAvailability().then((result) => setBiometricAvailable(result.available));
  }, []);

  function signedIn() {
    // Not awaited: sign-in must not wait on the permission prompt or the network.
    void registerDeviceForPush().catch(() => false);
    navigation.navigate("Home");
  }

  async function handlePasswordLogin() {
    setError("");
    setLoading(true);
    try {
      await loginUser(username, password);
      signedIn();
    } catch (err) {
      if (err instanceof MfaRequiredError) {
        setCode("");
        setChallenge(err);
      } else {
        setError(err instanceof Error && err.message !== "Invalid username or password" ? err.message : t("auth.invalidLogin"));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCode() {
    if (!challenge) return;
    setError("");
    setLoading(true);
    try {
      await completeMfaLogin(challenge.challengeId, code);
      signedIn();
    } catch {
      setError(t("auth.codeWrong"));
    } finally {
      setLoading(false);
    }
  }

  async function handleBiometricLogin() {
    // WHY this only unlocks an ALREADY-established session (checked via
    // whether tokens exist in SecureStore in a real build) rather than
    // logging in from scratch: biometrics authenticate "is this the
    // same person who logged in with a password on this device before,"
    // not "who are you" — that first step always needs the real
    // credentials once, per device.
    const success = await authenticateWithBiometrics();
    if (success) {
      navigation.navigate("Home");
    } else {
      setError(t("auth.biometricFailed"));
    }
  }

  if (challenge) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{t("auth.codeTitle")}</Text>
        <Text style={styles.hint}>{t("auth.codeSentTo", { destination: challenge.destinationHint })}</Text>
        <TextInput
          style={[styles.input, styles.codeInput]} keyboardType="number-pad" maxLength={6} autoFocus
          value={code} onChangeText={(text) => setCode(text.replace(/\D/g, ""))} placeholder="123456"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.button} onPress={handleCode} disabled={loading || code.length < 6}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t("auth.codeVerify")}</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.backButton} onPress={() => { setChallenge(null); setPassword(""); setError(""); }}>
          <Text style={styles.biometricButtonText}>{t("auth.codeBack")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("auth.signInTitle")}</Text>

      <TextInput style={styles.input} placeholder={t("auth.username")} value={username} onChangeText={setUsername} autoCapitalize="none" />
      <TextInput style={styles.input} placeholder={t("auth.password")} value={password} onChangeText={setPassword} secureTextEntry />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={handlePasswordLogin} disabled={loading}>
        {loading ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.buttonText}>{t("auth.signInButton")}</Text>}
      </TouchableOpacity>

      {biometricAvailable && (
        <TouchableOpacity style={styles.biometricButton} onPress={handleBiometricLogin}>
          <Text style={styles.biometricButtonText}>{t("auth.useBiometrics")}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 24, justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "bold", color: "#1B2A4A", marginBottom: 20 },
  hint: { fontSize: 13, color: "#6B7280", marginBottom: 16 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 15 },
  codeInput: { textAlign: "center", fontSize: 24, letterSpacing: 8 },
  error: { color: "#DC2626", marginBottom: 12, fontSize: 13 },
  button: { backgroundColor: "#1B2A4A", borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "bold", fontSize: 16 },
  backButton: { marginTop: 14, paddingVertical: 12, alignItems: "center" },
  biometricButton: { marginTop: 14, borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  biometricButtonText: { color: "#1B2A4A", fontWeight: "600" },
});
