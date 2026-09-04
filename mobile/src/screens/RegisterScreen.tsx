import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { registerUser } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "Register">;

export default function RegisterScreen({ navigation }: Props) {
  const [form, setForm] = useState({ username: "", phone: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    setLoading(true);
    try {
      await registerUser(form);
      navigation.navigate("Login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create your account</Text>

      <TextInput style={styles.input} placeholder="Username" value={form.username} onChangeText={(v) => setForm({ ...form, username: v })} autoCapitalize="none" />
      <TextInput style={styles.input} placeholder="Phone number (+237...)" value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} keyboardType="phone-pad" />
      <TextInput style={styles.input} placeholder="Password" value={form.password} onChangeText={(v) => setForm({ ...form, password: v })} secureTextEntry />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Register</Text>}
      </TouchableOpacity>

      <Text style={styles.notice}>
        Multi-factor authentication and identity verification (KYC) will be set up on your next login, per the platform's security requirements.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 24, justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "bold", color: "#1B2A4A", marginBottom: 20 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 15 },
  error: { color: "#DC2626", marginBottom: 12, fontSize: 13 },
  button: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  buttonText: { color: "#1B2A4A", fontWeight: "bold", fontSize: 16 },
  notice: { fontSize: 12, color: "#6B7280", marginTop: 16 },
});
