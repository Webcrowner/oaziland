import { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { loginUser } from "../lib/api";
import { checkBiometricAvailability, authenticateWithBiometrics } from "../lib/biometrics";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;

export default function LoginScreen({ navigation }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  useEffect(() => {
    checkBiometricAvailability().then((result) => setBiometricAvailable(result.available));
  }, []);

  async function handlePasswordLogin() {
    setError("");
    setLoading(true);
    try {
      await loginUser(username, password);
      navigation.navigate("Home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
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
      setError("Biometric authentication failed or was cancelled.");
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign in</Text>

      <TextInput style={styles.input} placeholder="Username" value={username} onChangeText={setUsername} autoCapitalize="none" />
      <TextInput style={styles.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={handlePasswordLogin} disabled={loading}>
        {loading ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.buttonText}>Sign In</Text>}
      </TouchableOpacity>

      {biometricAvailable && (
        <TouchableOpacity style={styles.biometricButton} onPress={handleBiometricLogin}>
          <Text style={styles.biometricButtonText}>Use Face ID / Fingerprint</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 24, justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "bold", color: "#1B2A4A", marginBottom: 20 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 15 },
  error: { color: "#DC2626", marginBottom: 12, fontSize: 13 },
  button: { backgroundColor: "#1B2A4A", borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "bold", fontSize: 16 },
  biometricButton: { marginTop: 14, borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  biometricButtonText: { color: "#1B2A4A", fontWeight: "600" },
});
