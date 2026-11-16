import { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Modal } from "react-native";
import {
  getMarketplaceBoostOptions, boostMarketplaceListing,
  type BoostOption, type BoostPayWith, type BoostUnit, type BrowsableCategory,
} from "../lib/api";
import { boostLengthLabel, boostOption, boostTotal, clampBoostQuantity } from "../lib/marketplaceBoost";
import { useI18n } from "../i18n";

interface Props {
  target: { category: BrowsableCategory; id: string; title: string } | null;
  onClose: () => void;
  onBoosted: () => void;
}

/** Buy a TOP boost for one listing: pick the length, then pay from the wallet or by Mobile Money. */
export default function BoostListingModal({ target, onClose, onBoosted }: Props) {
  const { t, locale } = useI18n();
  const [options, setOptions] = useState<BoostOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [unit, setUnit] = useState<BoostUnit>("DAILY");
  const [quantity, setQuantity] = useState(1);
  const [payWith, setPayWith] = useState<BoostPayWith>("WALLET");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    if (!target) return;
    setLoading(true);
    setError("");
    setDone("");
    setQuantity(1);
    getMarketplaceBoostOptions()
      .then((loaded) => {
        setOptions(loaded);
        if (loaded.length > 0) setUnit(loaded[0].duration_unit);
      })
      .catch((err) => setError(err instanceof Error ? err.message : t("mkt.boost.loadFailed")))
      .finally(() => setLoading(false));
  }, [target, t]);

  const option = boostOption(options, unit);
  const total = option ? boostTotal(option.unit_price_xaf, quantity) : 0;
  const canPay = Boolean(option) && !busy && (payWith === "WALLET" || phone.trim().length > 0);

  function pickUnit(next: BoostUnit) {
    setUnit(next);
    const nextOption = boostOption(options, next);
    setQuantity((current) => clampBoostQuantity(current, nextOption?.max_quantity ?? 1));
  }

  async function submit() {
    if (!target || !option) return;
    setBusy(true);
    setError("");
    try {
      const result = await boostMarketplaceListing(target.category, target.id, {
        duration_unit: unit, quantity, pay_with: payWith, phone_number: payWith === "MOMO" ? phone.trim() : "",
      });
      setDone(t("mkt.boost.boostedUntil", { date: new Date(result.boosted_until).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) }));
      onBoosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mkt.boost.boostFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={target !== null} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{t("mkt.boost.title", { title: target?.title ?? "" })}</Text>
          <Text style={styles.text}>{t("mkt.boost.intro")}</Text>

          {loading ? <ActivityIndicator color="#1B2A4A" style={styles.spinner} /> : done ? (
            <View>
              <Text style={styles.success}>{done}</Text>
              <TouchableOpacity style={styles.primary} onPress={onClose}><Text style={styles.primaryText}>{t("mkt.boost.done")}</Text></TouchableOpacity>
            </View>
          ) : options.length === 0 ? (
            <View>
              {error ? <Text style={styles.error}>{error}</Text> : <Text style={styles.text}>{t("mkt.boost.notOnSale")}</Text>}
              <TouchableOpacity onPress={onClose}><Text style={styles.cancel}>{t("mkt.boost.close")}</Text></TouchableOpacity>
            </View>
          ) : (
            <View>
              <Text style={styles.label}>{t("mkt.boost.length")}</Text>
              <View style={styles.chips}>
                {options.map((o) => (
                  <TouchableOpacity key={o.duration_unit} style={[styles.chip, unit === o.duration_unit && styles.chipActive]} onPress={() => pickUnit(o.duration_unit)}>
                    <Text style={[styles.chipText, unit === o.duration_unit && styles.chipTextActive]}>
                      {t(o.duration_unit === "DAILY" ? "mkt.boost.perDay" : "mkt.boost.perMonth")} · {Number(o.unit_price_xaf).toLocaleString()} XAF
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.stepper}>
                <TouchableOpacity style={styles.stepButton} onPress={() => setQuantity(clampBoostQuantity(quantity - 1, option?.max_quantity ?? 1))} accessibilityLabel={t("mkt.cart.fewer")}><Text style={styles.stepText}>−</Text></TouchableOpacity>
                <Text style={styles.stepValue}>{boostLengthLabel(unit, quantity, t)}</Text>
                <TouchableOpacity style={styles.stepButton} onPress={() => setQuantity(clampBoostQuantity(quantity + 1, option?.max_quantity ?? 1))} accessibilityLabel={t("mkt.cart.more")}><Text style={styles.stepText}>+</Text></TouchableOpacity>
              </View>
              <Text style={styles.total}>{t("mkt.boost.total", { amount: total.toLocaleString() })}</Text>

              <Text style={styles.label}>{t("mkt.boost.payWith")}</Text>
              <View style={styles.chips}>
                {(["WALLET", "MOMO"] as BoostPayWith[]).map((value) => (
                  <TouchableOpacity key={value} style={[styles.chip, payWith === value && styles.chipActive]} onPress={() => setPayWith(value)}>
                    <Text style={[styles.chipText, payWith === value && styles.chipTextActive]}>{value === "WALLET" ? t("mkt.boost.wallet") : "Mobile Money"}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {payWith === "MOMO" && (
                <TextInput style={styles.input} placeholder={t("mkt.cart.phone")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
              )}
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.buttons}>
                <TouchableOpacity style={[styles.primary, !canPay && styles.disabled]} disabled={!canPay} onPress={submit}>
                  {busy ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.primaryText}>{t("mkt.cart.payAmount", { amount: `${total.toLocaleString()} XAF` })}</Text>}
                </TouchableOpacity>
                <TouchableOpacity onPress={onClose}><Text style={styles.cancel}>{t("common.cancel")}</Text></TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20 },
  title: { fontSize: 17, fontWeight: "700", color: "#1B2A4A", marginBottom: 4 },
  text: { fontSize: 13, color: "#4B5563", marginBottom: 12 },
  spinner: { marginVertical: 20 },
  label: { fontSize: 12, fontWeight: "700", color: "#374151", marginBottom: 6, marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  chip: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  chipActive: { backgroundColor: "#1B2A4A", borderColor: "#1B2A4A" },
  chipText: { fontSize: 13, color: "#374151" },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 8 },
  stepButton: { width: 36, height: 36, borderRadius: 8, borderWidth: 1, borderColor: "#1B2A4A", alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 18, color: "#1B2A4A", fontWeight: "700" },
  stepValue: { fontSize: 15, fontWeight: "700", color: "#1B2A4A", minWidth: 80, textAlign: "center" },
  total: { fontSize: 16, fontWeight: "700", color: "#1B2A4A", marginBottom: 12 },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 8, fontSize: 14 },
  error: { color: "#DC2626", fontSize: 13, marginBottom: 8 },
  success: { color: "#16A34A", fontSize: 14, fontWeight: "600", marginBottom: 12 },
  buttons: { flexDirection: "row", alignItems: "center", gap: 18 },
  primary: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 11, paddingHorizontal: 18, alignItems: "center" },
  primaryText: { color: "#1B2A4A", fontWeight: "700", fontSize: 14 },
  disabled: { opacity: 0.5 },
  cancel: { color: "#6B7280", fontSize: 14 },
});
