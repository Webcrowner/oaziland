import { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { getMyCreatorPremiumStatus, subscribeCreatorPremium, cancelCreatorPremium } from "../lib/api";

/** Creator Premium — mobile parity with the web app's /premium page. */
export default function PremiumScreen() {
  const [isPremium, setIsPremium] = useState(false);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    getMyCreatorPremiumStatus().then((data) => setIsPremium(data.is_premium)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function handleSubscribe() {
    setSubmitting(true);
    setError("");
    try {
      await subscribeCreatorPremium(phone);
      setIsPremium(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Subscription failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    try {
      await cancelCreatorPremium();
      setCancelled(true);
    } catch {
      setError("Could not cancel. Please try again.");
    }
  }

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Creator Premium</Text>
      <Text style={styles.subtitle}>Stand out with a checkmark and a real feed-ranking boost.</Text>
      <Text style={styles.price}>500 XAF / month</Text>

      <View style={styles.benefitsList}>
        <Text style={styles.benefit}>✓ A real checkmark on your profile</Text>
        <Text style={styles.benefit}>✓ A modest, real feed-ranking boost</Text>
        <Text style={styles.benefit}>✓ Cancel anytime</Text>
      </View>

      {isPremium ? (
        <View>
          <Text style={styles.subscribedText}>✓ You're subscribed!</Text>
          {cancelled ? (
            <Text style={styles.cancelledText}>Your subscription will not renew.</Text>
          ) : (
            <TouchableOpacity onPress={handleCancel}><Text style={styles.cancelLink}>Cancel Subscription</Text></TouchableOpacity>
          )}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      ) : (
        <View>
          <TextInput style={styles.input} placeholder="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <TouchableOpacity style={styles.subscribeButton} onPress={handleSubscribe} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.subscribeButtonText}>Subscribe</Text>}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { padding: 24, alignItems: "center" },
  title: { fontSize: 22, fontWeight: "700", color: "#1B2A4A", marginBottom: 4 },
  subtitle: { fontSize: 13, color: "#6B7280", textAlign: "center", marginBottom: 8 },
  price: { fontSize: 24, fontWeight: "700", color: "#C9A227", marginBottom: 16 },
  benefitsList: { alignSelf: "stretch", marginBottom: 24 },
  benefit: { fontSize: 13, color: "#374151", marginBottom: 6 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 12, width: 260, fontSize: 14 },
  subscribeButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, alignItems: "center", width: 260 },
  subscribeButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 15 },
  subscribedText: { color: "#16A34A", fontWeight: "700", fontSize: 15, marginBottom: 8 },
  cancelledText: { fontSize: 13, color: "#6B7280" },
  cancelLink: { fontSize: 13, color: "#DC2626", textDecorationLine: "underline" },
  errorText: { color: "#DC2626", fontSize: 13, marginTop: 8 },
});
