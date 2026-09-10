import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { submitContactMessage } from "../lib/api";

/**
 * Contact — mobile parity with the web app's /contact page. A real,
 * working form — posts to the actual public /api/contact/ endpoint,
 * not a decorative form that goes nowhere.
 */
export default function ContactScreen() {
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");

  async function handleSubmit() {
    setStatus("sending");
    try {
      await submitContactMessage(form);
      setStatus("success");
      setForm({ name: "", email: "", message: "" });
    } catch {
      setStatus("error");
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Contact Us</Text>
      <Text style={styles.subtitle}>We'll get back to you as soon as we can.</Text>

      <TextInput style={styles.input} placeholder="Name" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
      <TextInput style={styles.input} placeholder="Email" value={form.email} onChangeText={(v) => setForm({ ...form, email: v })} keyboardType="email-address" autoCapitalize="none" />
      <TextInput style={[styles.input, styles.textArea]} placeholder="Message" value={form.message} onChangeText={(v) => setForm({ ...form, message: v })} multiline numberOfLines={5} />

      {status === "success" && <Text style={styles.success}>Message sent!</Text>}
      {status === "error" && <Text style={styles.error}>Something went wrong. Please try again.</Text>}

      <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} disabled={status === "sending"}>
        {status === "sending" ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.submitButtonText}>Send</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20 },
  title: { fontSize: 20, fontWeight: "700", color: "#1B2A4A", marginBottom: 4 },
  subtitle: { fontSize: 13, color: "#6B7280", marginBottom: 16 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 14 },
  textArea: { height: 100, textAlignVertical: "top" },
  success: { color: "#16A34A", fontSize: 13, marginBottom: 10 },
  error: { color: "#DC2626", fontSize: 13, marginBottom: 10 },
  submitButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  submitButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 16 },
});
