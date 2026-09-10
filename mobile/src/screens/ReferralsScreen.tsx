import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import { getMyReferralCode } from "../lib/api";

/**
 * Referrals — mobile parity with the web app's /referrals page. A
 * real, persistent code fetched from the backend (generated lazily
 * on first request), with a real native share sheet — the mobile
 * equivalent of web's WhatsApp share link, using whatever app the
 * person actually wants to share through instead of assuming
 * WhatsApp specifically.
 */
export default function ReferralsScreen() {
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getMyReferralCode().then((data) => setCode(data.referral_code)).catch(() => {});
  }, []);

  async function handleCopy() {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleShare() {
    if (!code) return;
    await Share.share({ message: `Join me on Oaziland! Use my referral code ${code} when you sign up: https://oaziland.com/register?ref=${code}` });
  }

  if (!code) {
    return <View style={styles.centered}><Text style={styles.loading}>...</Text></View>;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your Referral Code</Text>
      <Text style={styles.subtitle}>Share this code and earn real rewards when your referral completes verification.</Text>

      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>Your Code</Text>
        <Text style={styles.code}>{code}</Text>
      </View>

      <TouchableOpacity style={styles.copyButton} onPress={handleCopy}>
        <Text style={styles.copyButtonText}>{copied ? "Copied!" : "Copy Code"}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
        <Text style={styles.shareButtonText}>Share</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  loading: { color: "#9CA3AF" },
  container: { padding: 24, alignItems: "center" },
  title: { fontSize: 20, fontWeight: "700", color: "#1B2A4A", marginBottom: 4 },
  subtitle: { fontSize: 13, color: "#6B7280", textAlign: "center", marginBottom: 24 },
  codeCard: { borderWidth: 2, borderColor: "#C9A227", borderStyle: "dashed", borderRadius: 10, paddingVertical: 20, paddingHorizontal: 30, marginBottom: 20, alignItems: "center" },
  codeLabel: { fontSize: 11, color: "#6B7280", marginBottom: 4 },
  code: { fontSize: 26, fontWeight: "700", color: "#1B2A4A", letterSpacing: 3 },
  copyButton: { borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 8, paddingVertical: 12, width: 240, alignItems: "center", marginBottom: 10 },
  copyButtonText: { color: "#1B2A4A", fontWeight: "700" },
  shareButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 14, width: 240, alignItems: "center" },
  shareButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 16 },
});
