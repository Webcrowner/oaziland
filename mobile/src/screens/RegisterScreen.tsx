import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { registerUser, type SignupRole } from "../lib/api";

type Props = NativeStackScreenProps<RootStackParamList, "Register">;

const STRINGS = {
  en: {
    title: "Create your account",
    username: "Username",
    phone: "Phone number (+237...)",
    password: "Password",
    roleLabel: "What do you want to do on Oaziland?",
    register: "Register",
    failed: "Registration failed",
    notice: "Multi-factor authentication and identity verification (KYC) will be set up on your next login, per the platform's security requirements.",
    roles: {
      renter: "Browse, rent or buy (normal user)",
      landlord: "List my properties (landlord)",
      agent: "Work as a real-estate agent",
      student: "Find student housing",
      technician: "Offer technician services (Taskln)",
      driver: "Drive and earn (OaziGo)",
    },
  },
  fr: {
    title: "Créez votre compte",
    username: "Nom d'utilisateur",
    phone: "Numéro de téléphone (+237...)",
    password: "Mot de passe",
    roleLabel: "Que souhaitez-vous faire sur Oaziland ?",
    register: "S'inscrire",
    failed: "Échec de l'inscription",
    notice: "L'authentification multifacteur et la vérification d'identité (KYC) seront configurées lors de votre prochaine connexion, conformément aux exigences de sécurité de la plateforme.",
    roles: {
      renter: "Parcourir, louer ou acheter (utilisateur normal)",
      landlord: "Publier mes biens (propriétaire)",
      agent: "Travailler comme agent immobilier",
      student: "Trouver un logement étudiant",
      technician: "Proposer des services de technicien (Taskln)",
      driver: "Conduire et gagner (OaziGo)",
    },
  },
} as const;

const ROLE_ORDER: SignupRole[] = ["renter", "landlord", "agent", "student", "technician", "driver"];

// Mobile has no i18n layer yet, so follow the device language.
function deviceLang(): keyof typeof STRINGS {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || "en";
  return locale.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export default function RegisterScreen({ navigation }: Props) {
  const s = STRINGS[deviceLang()];
  const [form, setForm] = useState<{ username: string; phone: string; password: string; role: SignupRole }>({
    username: "", phone: "", password: "", role: "renter",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    setLoading(true);
    try {
      await registerUser(form);
      navigation.navigate("Login");
    } catch (err) {
      setError(err instanceof Error ? err.message : s.failed);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{s.title}</Text>

      <TextInput style={styles.input} placeholder={s.username} value={form.username} onChangeText={(v) => setForm({ ...form, username: v })} autoCapitalize="none" />
      <TextInput style={styles.input} placeholder={s.phone} value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} keyboardType="phone-pad" />
      <TextInput style={styles.input} placeholder={s.password} value={form.password} onChangeText={(v) => setForm({ ...form, password: v })} secureTextEntry />

      <Text style={styles.label}>{s.roleLabel}</Text>
      <View style={styles.roleList}>
        {ROLE_ORDER.map((role) => {
          const selected = form.role === role;
          return (
            <TouchableOpacity
              key={role}
              style={[styles.roleChip, selected && styles.roleChipSelected]}
              onPress={() => setForm({ ...form, role })}
            >
              <Text style={[styles.roleChipText, selected && styles.roleChipTextSelected]}>{s.roles[role]}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{s.register}</Text>}
      </TouchableOpacity>

      <Text style={styles.notice}>
        {s.notice}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#fff" },
  container: { flexGrow: 1, backgroundColor: "#fff", padding: 24, justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "bold", color: "#1B2A4A", marginBottom: 20 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 15 },
  label: { fontSize: 13, fontWeight: "600", color: "#1B2A4A", marginBottom: 8 },
  roleList: { marginBottom: 12 },
  roleChip: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8 },
  roleChipSelected: { borderColor: "#C9A227", backgroundColor: "#FBF5DC" },
  roleChipText: { fontSize: 14, color: "#374151" },
  roleChipTextSelected: { color: "#1B2A4A", fontWeight: "600" },
  error: { color: "#DC2626", marginBottom: 12, fontSize: 13 },
  button: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  buttonText: { color: "#1B2A4A", fontWeight: "bold", fontSize: 16 },
  notice: { fontSize: 12, color: "#6B7280", marginTop: 16 },
});
