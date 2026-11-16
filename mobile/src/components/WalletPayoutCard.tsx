import { useCallback, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import { getMyWallet, withdrawWallet, withdrawalBlocker, type PayoutProvider, type WalletDetail } from "../lib/api";

const PROVIDERS: { value: PayoutProvider; label: string; dot: string }[] = [
  { value: "MTN_MOMO", label: "MTN Mobile Money", dot: "#FACC15" },
  { value: "ORANGE_MONEY", label: "Orange Money", dot: "#F97316" },
];

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  PENDING: { bg: "#FFFBEB", fg: "#92400E" },
  APPROVED: { bg: "#F0F9FF", fg: "#075985" },
  PAID_OUT: { bg: "#F0FDF4", fg: "#166534" },
  REJECTED: { bg: "#FEF2F2", fg: "#B91C1C" },
};


/** Wallet balance and Mobile Money cash-out, the app's version of the web WalletPayoutCard. */
export default function WalletPayoutCard({ title }: { title?: string }) {
  const { t, locale } = useI18n();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [wallet, setWallet] = useState<WalletDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [showForm, setShowForm] = useState(false);
  const [provider, setProvider] = useState<PayoutProvider>("MTN_MOMO");
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    getMyWallet()
      .then((data) => {
        setWallet(data);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  // Reload when coming back, e.g. after submitting identity verification.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function submit() {
    if (!wallet || busy) return;
    const value = Number(amount);
    const blocker = withdrawalBlocker(wallet, value);
    if (blocker) {
      setMessage({ ok: false, text: t(`wallet.block.${blocker}`) });
      return;
    }
    if (!phone.trim()) {
      setMessage({ ok: false, text: t("wallet.phoneRequired") });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await withdrawWallet({ amount_xaf: value, phone_number: phone.trim(), provider });
      setMessage({ ok: true, text: result.detail });
      setAmount("");
      load();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("wallet.failed") });
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return <View style={styles.card}><ActivityIndicator color="#1B2A4A" /></View>;
  }
  if (state === "error" || !wallet) {
    return (
      <View style={styles.card}>
        <Text style={styles.errorText}>{t("wallet.loadFailed")}</Text>
        <TouchableOpacity onPress={() => { setState("loading"); load(); }}><Text style={styles.link}>{t("common.tryAgain")}</Text></TouchableOpacity>
      </View>
    );
  }

  const balance = Number(wallet.balance_xaf || 0);
  const kycBlocker = wallet.kyc_status === "VERIFIED" ? null : withdrawalBlocker(wallet, 1);
  const recent = wallet.withdrawals.slice(0, 5);

  return (
    <View style={styles.card}>
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>{title ?? t("wallet.title")}</Text>
        <Text style={styles.balance}>{balance.toLocaleString(locale)} <Text style={styles.currency}>XAF</Text></Text>
        <Text style={styles.heroHint}>{t("wallet.availableHint")}</Text>
        {kycBlocker ? (
          <View>
            <Text style={styles.kyc}>{t(`wallet.block.${kycBlocker}`)}</Text>
            {wallet.kyc_status !== "PENDING" && (
              <TouchableOpacity style={[styles.withdrawBtn, { marginTop: 8 }]} onPress={() => navigation.navigate("Kyc")}>
                <Text style={styles.withdrawText}>{wallet.kyc_status === "REJECTED" ? t("wallet.resubmitId") : t("wallet.verifyIdentity")}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.withdrawBtn, balance <= 0 && styles.disabled]}
            disabled={balance <= 0}
            onPress={() => { setShowForm((v) => !v); setMessage(null); }}
          >
            <Text style={styles.withdrawText}>{showForm ? t("wallet.hideForm") : t("wallet.withdraw")}</Text>
          </TouchableOpacity>
        )}
      </View>

      {showForm && !kycBlocker && (
        <View style={styles.form}>
          <View style={styles.providerRow}>
            {PROVIDERS.map((p) => (
              <TouchableOpacity
                key={p.value}
                style={[styles.provider, provider === p.value && styles.providerActive]}
                onPress={() => setProvider(p.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: provider === p.value }}
              >
                <View style={[styles.dot, { backgroundColor: p.dot }]} />
                <Text style={styles.providerText}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={styles.input} placeholder={t("wallet.amountPlaceholder", { max: balance.toLocaleString(locale) })} value={amount} onChangeText={setAmount} keyboardType="numeric" />
          <TextInput style={styles.input} placeholder={t("wallet.phonePlaceholder")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <TouchableOpacity onPress={() => setAmount(String(balance))}><Text style={styles.link}>{t("wallet.withdrawAll", { amount: balance.toLocaleString(locale) })}</Text></TouchableOpacity>
          {message && <Text style={[styles.message, message.ok ? styles.messageOk : styles.messageErr]}>{message.text}</Text>}
          <TouchableOpacity style={[styles.submit, busy && styles.disabled]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{t("wallet.request")}</Text>}
          </TouchableOpacity>
        </View>
      )}
      {!showForm && message?.ok && <Text style={[styles.message, styles.messageOk]}>{message.text}</Text>}

      <Text style={styles.sectionTitle}>{t("wallet.recent")}</Text>
      {recent.length === 0 ? (
        <Text style={styles.empty}>{t("wallet.none")}</Text>
      ) : (
        recent.map((w) => {
          const tone = STATUS_STYLE[w.status] ?? { bg: "#F3F4F6", fg: "#374151" };
          return (
            <View key={w.id} style={styles.withdrawalRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.withdrawalAmount}>{Number(w.amount_xaf).toLocaleString(locale)} XAF</Text>
                <Text style={styles.withdrawalDate}>{t("wallet.requested", { date: new Date(w.requested_at).toLocaleDateString(locale) })}</Text>
                {w.status === "REJECTED" && w.rejection_reason ? <Text style={styles.declined}>{t("wallet.declined", { reason: w.rejection_reason })}</Text> : null}
              </View>
              <Text style={[styles.pill, { backgroundColor: tone.bg, color: tone.fg }]}>{t(`wallet.status.${w.status}` as MessageKey)}</Text>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 12, marginTop: 10 },
  hero: { backgroundColor: "#0F172A", borderRadius: 10, padding: 14 },
  heroLabel: { fontSize: 11, fontWeight: "700", color: "#FCD34D", textTransform: "uppercase" },
  balance: { fontSize: 28, fontWeight: "800", color: "#fff", marginTop: 4 },
  currency: { fontSize: 14, fontWeight: "600", color: "#CBD5E1" },
  heroHint: { fontSize: 11, color: "#94A3B8", marginTop: 2, marginBottom: 10 },
  kyc: { fontSize: 12, color: "#FDE68A", backgroundColor: "rgba(251,191,36,0.12)", borderRadius: 8, padding: 8 },
  withdrawBtn: { backgroundColor: "#FBBF24", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  withdrawText: { color: "#0F172A", fontWeight: "800", fontSize: 13 },
  disabled: { opacity: 0.45 },
  form: { marginTop: 10, padding: 10, backgroundColor: "#F9FAFB", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  providerRow: { flexDirection: "row", gap: 6, marginBottom: 8 },
  provider: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#D1D5DB", backgroundColor: "#fff", borderRadius: 8, padding: 8 },
  providerActive: { borderColor: "#F59E0B", backgroundColor: "#FFFBEB" },
  dot: { width: 10, height: 10, borderRadius: 5 },
  providerText: { fontSize: 12, fontWeight: "700", color: "#1F2937", flexShrink: 1 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", backgroundColor: "#fff", borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 8 },
  link: { fontSize: 12, color: "#1B2A4A", fontWeight: "700", textDecorationLine: "underline", marginBottom: 8 },
  message: { fontSize: 12, borderRadius: 8, padding: 8, marginBottom: 8, marginTop: 4 },
  messageOk: { backgroundColor: "#F0FDF4", color: "#166534" },
  messageErr: { backgroundColor: "#FEF2F2", color: "#B91C1C" },
  submit: { backgroundColor: "#1B2A4A", borderRadius: 8, paddingVertical: 11, alignItems: "center" },
  submitText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: "#1B2A4A", marginTop: 12, marginBottom: 6 },
  empty: { fontSize: 12, color: "#9CA3AF" },
  withdrawalRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  withdrawalAmount: { fontSize: 13, fontWeight: "700", color: "#111827" },
  withdrawalDate: { fontSize: 11, color: "#9CA3AF" },
  declined: { fontSize: 11, color: "#B91C1C" },
  pill: { fontSize: 10, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: "hidden" },
  errorText: { fontSize: 12, color: "#B91C1C", marginBottom: 4 },
});
