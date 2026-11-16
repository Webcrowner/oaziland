import { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, Image, StyleSheet, ActivityIndicator } from "react-native";
import {
  checkoutMarketplaceCart, quoteMarketplaceCart,
  type CartCheckoutResult, type CartGroup, type CartItem, type CartQuote,
} from "../lib/api";
import { clampQuantity } from "../lib/goodsCheckout";
import { normalizeCouponCode } from "../lib/marketplaceCoupons";
import {
  cartLineKey, checkoutBlocker, chosenDeliveryMethod, deliveryOptionLabel, formatXaf, needsDeliveryAddress, quoteRequest, type CartDeliveryMethod,
} from "../lib/marketplaceCart";
import { compareAtDisplay } from "../lib/compareAt";
import { PercentBadge, SaleCountdown } from "./SalePrice";

interface Props {
  group: CartGroup;
  busyKey: string | null;
  onSetQuantity: (item: CartItem, quantity: number) => void;
  onRemove: (item: CartItem) => void;
  onPaid: (result: CartCheckoutResult) => void;
  onOpenListing: (listingId: string) => void;
  onOpenShop: (sellerId: string) => void;
}

/** One seller's part of the cart: the items, and the delivery, coupon and Mobile Money payment for them. */
export default function CartSellerGroup({ group, busyKey, onSetQuantity, onRemove, onPaid, onOpenListing, onOpenShop }: Props) {
  const [picked, setPicked] = useState<CartDeliveryMethod | "">("");
  const [address, setAddress] = useState("");
  const [quoteAddress, setQuoteAddress] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState("");
  const [phone, setPhone] = useState("");
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");

  const method = chosenDeliveryMethod(group.delivery_options, picked);
  const itemsKey = group.items.map((i) => `${cartLineKey(i)}:${i.quantity}`).join(",");
  const blocker = checkoutBlocker(group, method, address, phone, quote !== null);

  useEffect(() => {
    setQuote(null);
    setQuoteError("");
    if (!group.can_checkout || method === "") return;
    let stale = false;
    quoteMarketplaceCart(quoteRequest(group.seller_id, method, quoteAddress, coupon))
      .then((next) => { if (!stale) setQuote(next); })
      .catch((err) => { if (!stale) setQuoteError(err instanceof Error ? err.message : "Could not work out the total."); });
    return () => { stale = true; };
  }, [group.seller_id, group.can_checkout, method, coupon, quoteAddress, itemsKey]);

  async function handlePay() {
    if (method === "" || !quote) return;
    setPaying(true);
    setPayError("");
    try {
      const request = quoteRequest(group.seller_id, method, address, quote.coupon_error ? "" : coupon);
      onPaid(await checkoutMarketplaceCart({ ...request, phone_number: phone.trim() }));
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Could not start the payment. Please try again.");
    } finally {
      setPaying(false);
    }
  }

  const discount = quote ? Number(quote.discount_xaf) : 0;

  return (
    <View style={styles.card}>
      <TouchableOpacity onPress={() => onOpenShop(group.seller_id)}>
        <Text style={styles.seller}>{group.seller_name}</Text>
      </TouchableOpacity>

      {group.items.map((item) => {
        const key = cartLineKey(item);
        const busy = busyKey === key;
        const unit = Number(item.unit_price_xaf);
        const compare = compareAtDisplay(item.compare_at_price_xaf, unit);
        const listPrice = item.on_sale ? Number(item.list_price_xaf) : 0;
        const was = Math.max(compare?.amount ?? 0, listPrice > unit ? listPrice : 0);
        return (
          <View key={key} style={[styles.item, !item.available && styles.itemOff]}>
            <TouchableOpacity onPress={() => onOpenListing(item.listing_id)}>
              {item.photo_url ? <Image source={{ uri: item.photo_url }} style={styles.photo} /> : <View style={[styles.photo, styles.photoEmpty]}><Text style={styles.photoEmptyText}>No photo</Text></View>}
            </TouchableOpacity>
            <View style={styles.itemBody}>
              <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
              {item.variant_label ? <Text style={styles.variant} numberOfLines={2}>{item.variant_label}</Text> : null}
              <View style={styles.priceRow}>
                <Text style={[styles.unit, item.on_sale && styles.unitSale]}>{formatXaf(item.unit_price_xaf)}</Text>
                {was > unit && <Text style={styles.struck}>{formatXaf(was)}</Text>}
                {compare && was === compare.amount && <PercentBadge percent={compare.percent} />}
              </View>
              {item.on_sale && <SaleCountdown endsAt={item.sale_ends_at} />}
              {!item.available ? (
                <Text style={styles.reason}>{item.reason || "This item is no longer available."}</Text>
              ) : (
                <View style={styles.stepper}>
                  <TouchableOpacity style={styles.stepButton} disabled={busy || item.quantity <= 1} onPress={() => onSetQuantity(item, clampQuantity(item.quantity - 1, item.stock))} accessibilityLabel="Fewer">
                    <Text style={styles.stepText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.stepValue}>{item.quantity}</Text>
                  <TouchableOpacity style={styles.stepButton} disabled={busy || item.quantity >= item.stock} onPress={() => onSetQuantity(item, clampQuantity(item.quantity + 1, item.stock))} accessibilityLabel="More">
                    <Text style={styles.stepText}>+</Text>
                  </TouchableOpacity>
                  <Text style={styles.line}>{formatXaf(item.line_total_xaf)}</Text>
                </View>
              )}
              <TouchableOpacity style={styles.removeButton} disabled={busy} onPress={() => onRemove(item)}>
                <Text style={styles.remove}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      <View style={styles.checkout}>
        {!quote && <View style={styles.totalRow}><Text style={styles.label}>Items</Text><Text style={styles.value}>{formatXaf(group.subtotal_xaf)}</Text></View>}

        <Text style={styles.heading}>How do you want to get them?</Text>
        {group.delivery_options.length === 0 ? (
          <Text style={styles.muted}>No delivery option works for all of these items together. Try checking out fewer items.</Text>
        ) : group.delivery_options.map((option) => (
          <TouchableOpacity key={option.method} style={[styles.option, method === option.method && styles.optionOn]} onPress={() => setPicked(option.method)}>
            <Text style={styles.optionText}>{method === option.method ? "● " : "○ "}{deliveryOptionLabel(option)}</Text>
          </TouchableOpacity>
        ))}
        {needsDeliveryAddress(method) && (
          <TextInput
            style={styles.input} placeholder="Delivery address" value={address} onChangeText={setAddress}
            onEndEditing={() => setQuoteAddress(address.trim())}
          />
        )}

        <Text style={styles.heading}>Discount code</Text>
        <View style={styles.couponRow}>
          <TextInput
            style={[styles.input, styles.couponInput]} placeholder="Have a coupon?" value={couponInput} autoCapitalize="characters" autoCorrect={false}
            onChangeText={setCouponInput} accessibilityLabel="Coupon code"
          />
          <TouchableOpacity style={[styles.applyButton, !couponInput.trim() && styles.disabled]} disabled={!couponInput.trim()} onPress={() => setCoupon(normalizeCouponCode(couponInput))}>
            <Text style={styles.applyText}>Apply</Text>
          </TouchableOpacity>
        </View>
        {quote?.coupon_error ? <Text style={styles.error}>{quote.coupon_error}</Text> : null}
        {coupon && quote && !quote.coupon_error && discount > 0 ? (
          <View style={styles.totalRow}>
            <Text style={styles.success}>Coupon {coupon} applied</Text>
            <TouchableOpacity onPress={() => { setCoupon(""); setCouponInput(""); }}><Text style={styles.remove}>Remove</Text></TouchableOpacity>
          </View>
        ) : null}

        {quoteError ? <Text style={styles.error}>{quoteError}</Text> : null}
        {quote && (
          <View style={styles.summary}>
            <View style={styles.totalRow}><Text style={styles.label}>Items</Text><Text style={styles.value}>{formatXaf(quote.subtotal_xaf)}</Text></View>
            {discount > 0 && <View style={styles.totalRow}><Text style={styles.label}>Discount</Text><Text style={styles.success}>−{formatXaf(discount)}</Text></View>}
            <View style={styles.totalRow}><Text style={styles.label}>Delivery</Text><Text style={styles.value}>{Number(quote.delivery_fee_xaf) > 0 ? formatXaf(quote.delivery_fee_xaf) : "Free"}</Text></View>
            <View style={styles.totalRow}><Text style={styles.total}>Total</Text><Text style={styles.total}>{formatXaf(quote.total_xaf)}</Text></View>
          </View>
        )}

        <TextInput style={styles.input} placeholder="Mobile money phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Text style={styles.note}>You make one Mobile Money payment for everything from {group.seller_name}. Each item then becomes its own order, tracked and refundable separately.</Text>
        {blocker && !paying ? <Text style={styles.muted}>{blocker}</Text> : null}
        {payError ? <Text style={styles.error}>{payError}</Text> : null}
        <TouchableOpacity style={[styles.payButton, (paying || Boolean(blocker)) && styles.disabled]} disabled={paying || Boolean(blocker)} onPress={handlePay}>
          {paying ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.payText}>{quote ? `Pay ${formatXaf(quote.total_xaf)}` : "Pay"}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 12, marginBottom: 16 },
  seller: { fontSize: 16, fontWeight: "700", color: "#1B2A4A", marginBottom: 8, textDecorationLine: "underline" },
  item: { flexDirection: "row", gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  itemOff: { opacity: 0.75 },
  photo: { width: 72, height: 72, borderRadius: 8 },
  photoEmpty: { backgroundColor: "#E5E7EB", justifyContent: "center", alignItems: "center" },
  photoEmptyText: { fontSize: 10, color: "#4B5563" },
  itemBody: { flex: 1 },
  title: { fontWeight: "700", color: "#1B2A4A", fontSize: 14 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  unit: { fontSize: 13, fontWeight: "700", color: "#1B2A4A" },
  unitSale: { color: "#B91C1C" },
  struck: { fontSize: 12, color: "#6B7280", textDecorationLine: "line-through" },
  reason: { fontSize: 12, color: "#B91C1C", marginTop: 4 },
  stepper: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 6 },
  stepButton: { width: 44, height: 44, borderRadius: 8, borderWidth: 1, borderColor: "#1B2A4A", alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 16, color: "#1B2A4A", fontWeight: "700" },
  stepValue: { fontSize: 15, fontWeight: "700", color: "#1B2A4A", minWidth: 22, textAlign: "center" },
  line: { marginLeft: "auto", fontSize: 13, fontWeight: "700", color: "#1B2A4A" },
  remove: { color: "#B91C1C", fontWeight: "600", textDecorationLine: "underline", fontSize: 12 },
  removeButton: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  variant: { fontSize: 12, color: "#4B5563", marginTop: 1 },
  checkout: { borderTopWidth: 1, borderTopColor: "#E5E7EB", paddingTop: 12, marginTop: 4 },
  heading: { fontSize: 13, fontWeight: "700", color: "#374151", marginTop: 10, marginBottom: 6 },
  option: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 8, padding: 10, marginBottom: 6 },
  optionOn: { borderColor: "#C9A227", backgroundColor: "#FFFBEB" },
  optionText: { fontSize: 13, color: "#1B2A4A" },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 14 },
  couponRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  couponInput: { flex: 1 },
  applyButton: { backgroundColor: "#1B2A4A", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16 },
  applyText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  summary: { backgroundColor: "#F9FAFB", borderRadius: 8, padding: 10, marginBottom: 10 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  label: { fontSize: 13, color: "#4B5563" },
  value: { fontSize: 13, color: "#1B2A4A", fontWeight: "600" },
  total: { fontSize: 15, fontWeight: "700", color: "#1B2A4A" },
  success: { color: "#15803D", fontWeight: "600", fontSize: 13 },
  error: { color: "#DC2626", fontSize: 13, marginBottom: 8 },
  muted: { color: "#6B7280", fontSize: 12, marginBottom: 8 },
  note: { fontSize: 12, color: "#4B5563", marginBottom: 8 },
  payButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  payText: { color: "#1B2A4A", fontWeight: "700", fontSize: 15 },
  disabled: { opacity: 0.5 },
});
