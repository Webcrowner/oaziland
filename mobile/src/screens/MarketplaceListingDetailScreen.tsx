import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity, Image, Alert, useWindowDimensions } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  getMarketplaceListing, getMyUserId, getMyFavorites, toggleFavoriteListing, placeMarketplaceOrder, getOrCreateConversation, getListingConditions,
  makeMarketplaceOffer, listMyMarketplaceOffers, marketplaceOfferAction, checkMarketplaceCoupon, setCartItem,
  type ListingConditionItem, type MarketplaceOffer, type MarketplaceOfferActionName,
  type WarehouseListing, type StoreListing, type BusinessListing, type CarListing, type GoodsListing,
} from "../lib/api";
import { PRICE_BASIS_LABELS } from "../lib/marketplaceFilters";
import { CONDITION_TARGETS } from "../lib/marketplaceConditions";
import { clampQuantity, deliveryOptions, goodsTotal, type DeliveryMethod } from "../lib/goodsCheckout";
import { canMakeOffer, offerAmountError, offerCurrentAmount, parseAmount } from "../lib/marketplaceOffers";
import { isOnSale, unitPriceXaf } from "../lib/flashSale";
import { formatXaf } from "../lib/marketplaceCart";
import { normalizeCouponCode } from "../lib/marketplaceCoupons";
import { compareAtDisplay } from "../lib/compareAt";
import { missingOptions, missingOptionsText, selectedVariant, variantPriceFields, type VariantSelection } from "../lib/goodsVariants";
import { useI18n } from "../i18n";
import SalePrice from "../components/SalePrice";
import VariantPicker from "../components/VariantPicker";
import RateAndReport from "../components/RateAndReport";
import ReportListingButton from "../components/ReportListingButton";
import SellerTrustCard from "../components/SellerTrustCard";
import MarketplaceReviews from "../components/MarketplaceReviews";

type Props = NativeStackScreenProps<RootStackParamList, "MarketplaceListingDetail">;
type AnyListing = WarehouseListing & Partial<StoreListing> & Partial<BusinessListing> & Partial<CarListing> & Partial<GoodsListing>;
type Viewer = "loading" | "signedOut" | "owner" | "buyer";

function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const CONDITION_FLAGS: [string, string][] = [
  ["deposit_required", "A security deposit is required"],
  ["insurance_required", "Insurance is required"],
  ["driver_required", "A driver is required"],
  ["no_subletting", "No subletting"],
  ["viewing_appointment_only", "Viewing by appointment only"],
];

/** The terms a lister set, in the order a buyer should read them. */
function conditionLines(items: ListingConditionItem[]): string[] {
  const lines: string[] = [];
  for (const item of items) {
    const c = item.structured_conditions;
    if (typeof c.min_lease_months === "number") lines.push(`Minimum lease: ${c.min_lease_months} months`);
    if (typeof c.mileage_cap_km === "number") lines.push(`Mileage cap: ${c.mileage_cap_km.toLocaleString()} km`);
    for (const [key, label] of CONDITION_FLAGS) if (c[key] === true) lines.push(label);
    if (item.free_text_clause) lines.push(item.free_text_clause);
  }
  return lines;
}

/** One marketplace listing: photos, details, save, buy or rent into escrow, and report. */
export default function MarketplaceListingDetailScreen({ route, navigation }: Props) {
  const { category, listingId } = route.params;
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const [selection, setSelection] = useState<VariantSelection>({});
  const [listing, setListing] = useState<AnyListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewer, setViewer] = useState<Viewer>("loading");
  const [isFavorited, setIsFavorited] = useState(false);
  const [phone, setPhone] = useState("");
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");
  const [placed, setPlaced] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);
  const [chatError, setChatError] = useState("");
  const [conditions, setConditions] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [method, setMethod] = useState<DeliveryMethod | "">("");
  const [address, setAddress] = useState("");
  const [offers, setOffers] = useState<MarketplaceOffer[]>([]);
  const [offerAmount, setOfferAmount] = useState("");
  const [offerMessage, setOfferMessage] = useState("");
  const [offerBusy, setOfferBusy] = useState(false);
  const [offerError, setOfferError] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; discount: number } | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponError, setCouponError] = useState("");
  const [cartBusy, setCartBusy] = useState(false);
  const [cartNotice, setCartNotice] = useState("");
  const [cartError, setCartError] = useState("");

  async function checkCoupon(code: string, forQuantity: number) {
    if (!listing) return;
    setCouponBusy(true);
    setCouponError("");
    try {
      const result = await checkMarketplaceCoupon(listing.id, forQuantity, code);
      if (result.valid) {
        setCoupon({ code: result.code || code, discount: Number(result.discount_xaf) || 0 });
      } else {
        setCoupon(null);
        setCouponError(result.message || "This coupon can't be used on this item.");
      }
    } catch (err) {
      setCoupon(null);
      setCouponError(err instanceof Error ? err.message : "Could not check the coupon. Please try again.");
    } finally {
      setCouponBusy(false);
    }
  }

  // The discount depends on how many are bought, so a coupon is checked again when the quantity changes.
  useEffect(() => {
    if (coupon) checkCoupon(coupon.code, quantity);
  }, [quantity]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAddToCart() {
    if (!listing) return;
    setCartBusy(true);
    setCartError("");
    setCartNotice("");
    try {
      const cart = await setCartItem(listing.id, quantity, chosenVariant?.id);
      setCartNotice(`Added to your cart (${cart.item_count} ${cart.item_count === 1 ? "item" : "items"}).`);
    } catch (err) {
      setCartError(err instanceof Error ? err.message : "Could not add it to your cart. Please try again.");
    } finally {
      setCartBusy(false);
    }
  }

  const loadOffers = useCallback(() => {
    listMyMarketplaceOffers("buying", listingId).then((data) => setOffers(data.results)).catch(() => {});
  }, [listingId]);

  useEffect(() => {
    if (viewer === "buyer") loadOffers();
  }, [viewer, loadOffers]);

  useEffect(() => {
    if (category === "goods") return;
    getListingConditions(CONDITION_TARGETS[category], listingId).then((items) => setConditions(conditionLines(items))).catch(() => {});
  }, [category, listingId]);

  const loadListing = useCallback(() => {
    getMarketplaceListing<AnyListing>(category, listingId)
      .then(setListing)
      .catch(() => setListing(null))
      .finally(() => setLoading(false));
  }, [category, listingId]);

  useEffect(() => { loadListing(); }, [loadListing]);

  useEffect(() => {
    SecureStore.getItemAsync("access_token").then((token) => {
      if (!token) {
        setViewer("signedOut");
        return;
      }
      getMyFavorites().then((data) => setIsFavorited(data.listing_ids.includes(listingId))).catch(() => {});
    });
  }, [listingId]);

  useEffect(() => {
    if (!listing) return;
    SecureStore.getItemAsync("access_token").then(async (token) => {
      if (!token) return;
      try {
        setViewer((await getMyUserId()) === listing.lister_user ? "owner" : "buyer");
      } catch {
        setViewer("signedOut");
      }
    });
  }, [listing]);

  async function handleToggleFavorite() {
    if (viewer === "signedOut") {
      navigation.navigate("Login");
      return;
    }
    try {
      setIsFavorited((await toggleFavoriteListing(listingId)).is_favorited);
    } catch {
      Alert.alert("Could not save", "Please try again.");
    }
  }

  async function handlePay() {
    if (!listing) return;
    setPaying(true);
    setPayError("");
    try {
      const goods = isGoods
        ? {
          quantity: acceptedOffer ? 1 : quantity, ...(chosenMethod ? { delivery_method: chosenMethod } : {}),
          ...(chosenMethod && chosenMethod !== "PICKUP" ? { delivery_address: address.trim() } : {}),
          ...(chosenVariant ? { variant_id: chosenVariant.id } : {}),
        }
        : undefined;
      await placeMarketplaceOrder(category, listing.id, phone.trim(), goods, acceptedOffer?.id, isGoods && !acceptedOffer && coupon ? { couponCode: coupon.code } : undefined);
      setPlaced(true);
      loadListing();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Could not place the order. Please try again.");
    } finally {
      setPaying(false);
    }
  }

  async function handleMakeOffer() {
    if (!listing) return;
    const invalid = offerAmountError(offerAmount, Number(listing.price_xaf));
    if (invalid) {
      setOfferError(invalid);
      return;
    }
    setOfferBusy(true);
    setOfferError("");
    try {
      await makeMarketplaceOffer(category, listing.id, parseAmount(offerAmount) ?? 0, offerMessage.trim());
      setOfferAmount("");
      setOfferMessage("");
      loadOffers();
    } catch (err) {
      setOfferError(err instanceof Error ? err.message : "Could not send your offer. Please try again.");
    } finally {
      setOfferBusy(false);
    }
  }

  async function handleOfferAction(offer: MarketplaceOffer, action: MarketplaceOfferActionName) {
    setOfferBusy(true);
    setOfferError("");
    try {
      await marketplaceOfferAction(offer.id, action);
      loadOffers();
    } catch (err) {
      setOfferError(err instanceof Error ? err.message : "That did not work. Please try again.");
    } finally {
      setOfferBusy(false);
    }
  }

  async function handleChat() {
    if (!listing) return;
    if (viewer === "signedOut") {
      navigation.navigate("Login");
      return;
    }
    setOpeningChat(true);
    setChatError("");
    try {
      const conversation = await getOrCreateConversation(listing.lister_user);
      navigation.navigate("Conversation", {
        conversationId: conversation.id,
        participantNames: listing.lister_name || "Seller",
      });
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Could not open the conversation.");
    } finally {
      setOpeningChat(false);
    }
  }

  if (loading) return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  if (!listing) return <View style={styles.centered}><Text>This listing could not be found.</Text></View>;

  const isSale = listing.price_basis === "SALE";
  const isGoods = category === "goods";
  const variants = isGoods ? (listing.variants ?? []) : [];
  const hasVariants = isGoods && Boolean(listing.has_variants) && variants.length > 0;
  const chosenVariant = hasVariants ? selectedVariant(variants, selection) : null;
  const needsVariant = hasVariants && chosenVariant === null;
  const options = isGoods ? deliveryOptions({
    pickup_available: Boolean(listing.pickup_available), seller_delivery: Boolean(listing.seller_delivery),
    seller_delivery_fee_xaf: listing.seller_delivery_fee_xaf ?? null, courier_shipping: Boolean(listing.courier_shipping),
    courier_fee_xaf: listing.courier_fee_xaf ?? null,
  }) : [];
  const stock = hasVariants ? (chosenVariant?.quantity ?? 0) : Number(listing.quantity ?? 1);
  // A single way to receive the item needs no choice.
  const chosenMethod: DeliveryMethod | "" = options.length === 1 ? options[0].method : method;
  const chosenOption = options.find((o) => o.method === chosenMethod);
  const needsAddress = chosenMethod !== "" && chosenMethod !== "PICKUP";
  const goodsReady = !isGoods || (!needsVariant && options.length > 0 && chosenMethod !== "" && (!needsAddress || address.trim().length >= 5));
  const openOffer = offers.find((o) => o.status === "PENDING" || o.status === "COUNTERED" || o.status === "ACCEPTED");
  // An accepted price only holds until pay_by; after that the server refuses it, so the full price applies again.
  const acceptedOffer = openOffer?.status === "ACCEPTED" && openOffer.pay_by && new Date(openOffer.pay_by).getTime() > Date.now() ? openOffer : undefined;
  const saleActive = isGoods && isOnSale(listing);
  const onVacation = Boolean(listing.seller_on_vacation);
  const priceFields = chosenVariant ? variantPriceFields(listing, chosenVariant) : listing;
  const richPrice = isGoods && (saleActive || hasVariants || compareAtDisplay(listing.compare_at_price_xaf, Number(listing.price_xaf)) !== null);
  const variantUnit = chosenVariant ? unitPriceXaf(priceFields) : Number(listing.price_from_xaf ?? listing.price_xaf);
  const unitPrice = acceptedOffer ? offerCurrentAmount(acceptedOffer) : hasVariants ? variantUnit : unitPriceXaf(listing);
  const price = Number(listing.price_xaf).toLocaleString();
  const depositValue = Number(listing.security_deposit_xaf ?? 0);
  const couponDiscount = isGoods && !acceptedOffer && coupon ? coupon.discount : 0;
  // The buyer is charged the price plus any refundable rental deposit in a single payment.
  const payTotalValue = isGoods
    ? Math.max(0, goodsTotal(unitPrice, acceptedOffer ? 1 : quantity, chosenOption?.feeXaf ?? 0) - couponDiscount)
    : unitPrice + depositValue;
  const payTotal = payTotalValue.toLocaleString();
  const canAddToCart = isGoods && viewer === "buyer" && !acceptedOffer && (hasVariants ? variants.some((v) => v.available) : stock > 0);
  const pickHint = needsVariant ? t("variants.pick", { names: missingOptionsText(missingOptions(variants, selection), t("variants.and")) }) : "";
  const photoSlides = [
    ...(chosenVariant?.photo_url ? [{ id: "variant", file_url: chosenVariant.photo_url }] : []),
    ...listing.media.filter((m) => m.media_type === "PHOTO").map((m) => ({ id: String(m.id), file_url: m.file_url })),
  ];

  function handleSelectVariant(next: VariantSelection) {
    setSelection(next);
    const picked = selectedVariant(variants, next);
    if (picked) setQuantity((q) => clampQuantity(q, picked.quantity));
  }
  const facts: string[] = [];
  if (listing.size_sqm) facts.push(`${listing.size_sqm} m²`);
  if (listing.frontage_meters) facts.push(`Frontage ${listing.frontage_meters} m`);
  if (listing.vehicle_spec) {
    const v = listing.vehicle_spec;
    facts.push(`${v.year} ${v.make} ${v.model}`);
    if (v.mileage_km) facts.push(`${v.mileage_km.toLocaleString()} km`);
  }
  if (listing.includes_goodwill) facts.push("Includes goodwill");
  if (listing.includes_inventory) facts.push("Includes inventory");
  if (listing.annual_revenue_xaf) facts.push(`Annual revenue ${Number(listing.annual_revenue_xaf).toLocaleString()} XAF`);
  const photoCount = photoSlides.length;

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      {photoCount > 0 ? (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
          {photoSlides.map((p) => <Image key={p.id} source={{ uri: p.file_url }} style={[styles.photo, { width }]} />)}
        </ScrollView>
      ) : (
        <View style={[styles.photo, styles.photoPlaceholder]}><Text style={styles.photoPlaceholderText}>No photo yet</Text></View>
      )}

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{listing.title}</Text>
          <TouchableOpacity onPress={handleToggleFavorite} accessibilityLabel={isFavorited ? "Remove from saved" : "Save listing"}>
            <Text style={styles.star}>{isFavorited ? "★" : "☆"}</Text>
          </TouchableOpacity>
        </View>
        {listing.is_boosted && <Text style={styles.topBadge}>TOP</Text>}
        {richPrice ? (
          <View style={styles.saleBlock}>
            <SalePrice listing={priceFields} large />
          </View>
        ) : (
          <Text style={styles.price}>{price} XAF · {PRICE_BASIS_LABELS[listing.price_basis] ?? listing.price_basis}</Text>
        )}
        {listing.quarter_name ? <Text style={styles.meta}>📍 {listing.quarter_name}</Text> : null}
        {listing.availability_status === "UNDER_OFFER" && <Text style={styles.notice}>This listing is under offer.</Text>}
        {onVacation && <Text style={styles.vacation}>🏖 This seller is on vacation. Buying, adding to cart and offers are paused until they are back.</Text>}
        {facts.length > 0 && <View style={styles.factsRow}>{facts.map((f) => <Text key={f} style={styles.fact}>{f}</Text>)}</View>}
        {listing.description ? <Text style={styles.description}>{listing.description}</Text> : null}
        {conditions.length > 0 || depositValue > 0 ? (
          <View style={styles.conditions}>
            <Text style={styles.boxTitle}>Conditions & rules</Text>
            {depositValue > 0 && (
              <Text style={styles.conditionLine}>
                • Refundable security deposit: {depositValue.toLocaleString()} XAF. Paid with the rent and held in escrow; the seller returns it when the rental comes back in good order, or it returns to you automatically a few days after the rental ends.
              </Text>
            )}
            {conditions.map((line) => <Text key={line} style={styles.conditionLine}>• {line}</Text>)}
          </View>
        ) : null}

        {viewer === "buyer" && !placed && (openOffer || (canMakeOffer(listing, category, false) && !saleActive && !onVacation)) && (
          <View style={styles.box}>
            <Text style={styles.boxTitle}>{openOffer ? "Your offer" : "Make an offer"}</Text>
            {openOffer ? (
              <>
                <Text style={styles.boxText}>
                  {openOffer.status === "PENDING" && `Your offer of ${Number(openOffer.amount_xaf).toLocaleString()} XAF is waiting for the seller's answer.`}
                  {openOffer.status === "COUNTERED" && `The seller countered your ${Number(openOffer.amount_xaf).toLocaleString()} XAF offer with ${offerCurrentAmount(openOffer).toLocaleString()} XAF.`}
                  {openOffer.status === "ACCEPTED" && `Your offer of ${offerCurrentAmount(openOffer).toLocaleString()} XAF was accepted — pay by ${openOffer.pay_by ? formatMoment(openOffer.pay_by) : "the deadline"}.`}
                </Text>
                {openOffer.status === "PENDING" && openOffer.respond_by ? <Text style={styles.boxText}>The seller has until {formatMoment(openOffer.respond_by)} to answer.</Text> : null}
                {offerError ? <Text style={styles.error}>{offerError}</Text> : null}
                <View style={styles.offerActions}>
                  {openOffer.status === "COUNTERED" && (
                    <TouchableOpacity style={[styles.offerButton, offerBusy && styles.payButtonDisabled]} disabled={offerBusy} onPress={() => handleOfferAction(openOffer, "accept")}>
                      <Text style={styles.payButtonText}>Accept counter</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity disabled={offerBusy} onPress={() => handleOfferAction(openOffer, "withdraw")}>
                    <Text style={styles.danger}>Withdraw</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.boxText}>Asking {price} XAF. Offer a lower price and the seller can accept, decline or counter.</Text>
                <TextInput style={styles.input} placeholder="Your offer (XAF)" value={offerAmount} onChangeText={setOfferAmount} keyboardType="number-pad" />
                <TextInput style={styles.input} placeholder="Message to the seller (optional)" value={offerMessage} onChangeText={setOfferMessage} maxLength={500} />
                {offerError ? <Text style={styles.error}>{offerError}</Text> : null}
                <TouchableOpacity style={[styles.payButton, (offerBusy || !offerAmount.trim()) && styles.payButtonDisabled]} disabled={offerBusy || !offerAmount.trim()} onPress={handleMakeOffer}>
                  {offerBusy ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.payButtonText}>Send offer</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {viewer === "loading" ? null : viewer === "owner" ? (
          <View style={styles.box}><Text style={styles.boxText}>This is your listing.</Text></View>
        ) : placed ? (
          <View style={[styles.box, styles.boxSuccess]}>
            <Text style={styles.boxTitle}>Payment request sent</Text>
            <Text style={styles.boxText}>Approve the Mobile Money prompt. Your order will update after the payment provider confirms it.</Text>
            <TouchableOpacity onPress={() => navigation.navigate("MarketplaceOrders")}><Text style={styles.link}>View my orders</Text></TouchableOpacity>
          </View>
        ) : onVacation ? (
          <View style={styles.box}><Text style={styles.boxText}>This shop is on vacation, so purchases are paused. You can still chat with the seller or save the listing.</Text></View>
        ) : listing.availability_status !== "AVAILABLE" ? (
          <View style={styles.box}><Text style={styles.boxText}>This listing is not available right now.</Text></View>
        ) : (
          <View style={styles.buyBox}>
            <Text style={styles.boxTitle}>{acceptedOffer ? "Pay your agreed price" : isSale ? "Buy this listing" : "Rent this listing"}</Text>
            <Text style={styles.boxText}>Your payment is held safely in escrow. The seller is only paid after you confirm you received what you paid for.</Text>
            {viewer === "signedOut" ? (
              <TouchableOpacity style={styles.payButton} onPress={() => navigation.navigate("Login")}>
                <Text style={styles.payButtonText}>Sign in to buy</Text>
              </TouchableOpacity>
            ) : (
              <>
                {isGoods && (
                  <View style={styles.goodsBlock}>
                    {hasVariants && (
                      <View style={styles.variantBlock}>
                        <VariantPicker variants={variants} selection={selection} onChange={handleSelectVariant} />
                        {pickHint ? <Text style={styles.pickHint}>{pickHint}</Text> : null}
                      </View>
                    )}
                    {!acceptedOffer && !needsVariant && (
                      <>
                        <Text style={styles.label}>{hasVariants ? t("variants.inStock", { count: stock }) : `Quantity (${stock} in stock)`}</Text>
                        <View style={styles.stepper}>
                          <TouchableOpacity style={styles.stepButton} onPress={() => setQuantity(clampQuantity(quantity - 1, stock))} accessibilityLabel="Fewer"><Text style={styles.stepText}>−</Text></TouchableOpacity>
                          <Text style={styles.stepValue}>{quantity}</Text>
                          <TouchableOpacity style={styles.stepButton} onPress={() => setQuantity(clampQuantity(quantity + 1, stock))} accessibilityLabel="More"><Text style={styles.stepText}>+</Text></TouchableOpacity>
                        </View>
                      </>
                    )}
                    <Text style={styles.label}>How do you want to get it?</Text>
                    {options.map((o) => (
                      <TouchableOpacity key={o.method} style={[styles.option, chosenMethod === o.method && styles.optionOn]} onPress={() => setMethod(o.method)}>
                        <Text style={styles.optionText}>{chosenMethod === o.method ? "● " : "○ "}{o.label}{o.feeXaf > 0 ? ` · +${o.feeXaf.toLocaleString()} XAF` : ""}</Text>
                      </TouchableOpacity>
                    ))}
                    {needsAddress && (
                      <TextInput style={styles.input} placeholder="Delivery address" value={address} onChangeText={setAddress} />
                    )}
                    {!acceptedOffer && (
                      <View>
                        <Text style={styles.label}>Have a coupon?</Text>
                        {coupon ? (
                          <View style={styles.couponRow}>
                            <Text style={styles.couponApplied}>Coupon {coupon.code} applied: −{formatXaf(coupon.discount)}</Text>
                            <TouchableOpacity onPress={() => { setCoupon(null); setCouponInput(""); setCouponError(""); }}><Text style={styles.danger}>Remove</Text></TouchableOpacity>
                          </View>
                        ) : (
                          <View style={styles.couponRow}>
                            <TextInput
                              style={[styles.input, styles.couponInput]} placeholder="Enter your code" value={couponInput} onChangeText={setCouponInput}
                              autoCapitalize="characters" autoCorrect={false} accessibilityLabel="Coupon code"
                            />
                            <TouchableOpacity style={[styles.applyButton, (couponBusy || !couponInput.trim()) && styles.payButtonDisabled]} disabled={couponBusy || !couponInput.trim()} onPress={() => checkCoupon(normalizeCouponCode(couponInput), quantity)}>
                              {couponBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.applyText}>Apply</Text>}
                            </TouchableOpacity>
                          </View>
                        )}
                        {couponError ? <Text style={styles.error}>{couponError}</Text> : null}
                      </View>
                    )}
                  </View>
                )}
                {canAddToCart && (
                  <View style={styles.cartBlock}>
                    <TouchableOpacity style={[styles.cartButton, (cartBusy || needsVariant) && styles.payButtonDisabled]} disabled={cartBusy || needsVariant} onPress={handleAddToCart}>
                      {cartBusy ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.cartButtonText}>Add to cart</Text>}
                    </TouchableOpacity>
                    {cartNotice ? (
                      <Text style={styles.boxText}>{cartNotice} <Text style={styles.link} onPress={() => navigation.navigate("MarketplaceCart")}>View cart</Text></Text>
                    ) : null}
                    {cartError ? <Text style={styles.error}>{cartError}</Text> : null}
                  </View>
                )}
                {isGoods && couponDiscount > 0 && (
                  <Text style={styles.boxText}>Discount −{formatXaf(couponDiscount)} is included in the total below.</Text>
                )}
                <TextInput style={styles.input} placeholder="Mobile money phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
                {payError ? <Text style={styles.error}>{payError}</Text> : null}
                <TouchableOpacity style={[styles.payButton, (paying || !phone.trim() || !goodsReady) && styles.payButtonDisabled]} onPress={handlePay} disabled={paying || !phone.trim() || !goodsReady}>
                  {paying ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.payButtonText}>Pay {payTotal} XAF</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {viewer !== "owner" && viewer !== "loading" && (
          <>
            <TouchableOpacity style={styles.chatButton} onPress={handleChat} disabled={openingChat}>
              {openingChat ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.chatButtonText}>Chat with seller</Text>}
            </TouchableOpacity>
            {chatError ? <Text style={styles.error}>{chatError}</Text> : null}
            <ReportListingButton listingId={listing.id} />
          </>
        )}

        <MarketplaceReviews category={category} listingId={listingId} />

        <View style={styles.lister}>
          <SellerTrustCard sellerId={listing.lister_user} sellerName={listing.lister_name} />
          {viewer !== "owner" && viewer !== "loading" && viewer !== "signedOut" && <RateAndReport subjectUserId={listing.lister_user} />}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  photo: { height: 240 },
  photoPlaceholder: { backgroundColor: "#E5E7EB", justifyContent: "center", alignItems: "center", width: "100%" },
  photoPlaceholderText: { color: "#4B5563" },
  body: { padding: 16 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  title: { flex: 1, fontSize: 20, fontWeight: "700", color: "#1B2A4A" },
  star: { fontSize: 28, color: "#C9A227" },
  price: { fontSize: 16, fontWeight: "700", color: "#1B2A4A", marginTop: 4 },
  meta: { fontSize: 13, color: "#6B7280", marginTop: 4 },
  notice: { fontSize: 13, color: "#A8502E", marginTop: 6 },
  vacation: { fontSize: 13, color: "#92400E", backgroundColor: "#FFFBEB", borderRadius: 8, padding: 10, marginTop: 8, overflow: "hidden" },
  saleBlock: { marginTop: 4 },
  couponRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 4 },
  couponInput: { flex: 1 },
  couponApplied: { flex: 1, color: "#15803D", fontWeight: "600", fontSize: 13, marginBottom: 8 },
  applyButton: { backgroundColor: "#1B2A4A", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16 },
  applyText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  cartBlock: { marginBottom: 10 },
  cartButton: { borderWidth: 1, borderColor: "#1B2A4A", borderRadius: 8, paddingVertical: 12, alignItems: "center", marginBottom: 6 },
  cartButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 15 },
  factsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  fact: { fontSize: 12, color: "#374151", backgroundColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, overflow: "hidden" },
  description: { fontSize: 14, color: "#374151", marginTop: 12, lineHeight: 20 },
  conditions: { backgroundColor: "#F3F4F6", borderRadius: 10, padding: 14, marginTop: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  conditionLine: { fontSize: 13, color: "#374151", marginTop: 4, lineHeight: 18 },
  box: { backgroundColor: "#F3F4F6", borderRadius: 10, padding: 14, marginTop: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  boxSuccess: { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" },
  buyBox: { backgroundColor: "#fff", borderRadius: 10, padding: 14, marginTop: 16, borderWidth: 1, borderColor: "#C9A227" },
  boxTitle: { fontSize: 15, fontWeight: "700", color: "#1B2A4A", marginBottom: 4 },
  boxText: { fontSize: 12, color: "#4B5563", marginBottom: 8 },
  link: { fontSize: 13, fontWeight: "700", color: "#1B2A4A", textDecorationLine: "underline" },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, marginBottom: 8, fontSize: 14 },
  goodsBlock: { marginBottom: 4 },
  variantBlock: { marginBottom: 6 },
  pickHint: { fontSize: 12, color: "#92400E", marginBottom: 6 },
  label: { fontSize: 12, fontWeight: "700", color: "#374151", marginBottom: 6, marginTop: 4 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 8 },
  stepButton: { width: 44, height: 44, borderRadius: 8, borderWidth: 1, borderColor: "#1B2A4A", alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 18, color: "#1B2A4A", fontWeight: "700" },
  stepValue: { fontSize: 16, fontWeight: "700", color: "#1B2A4A", minWidth: 24, textAlign: "center" },
  option: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 8, padding: 10, marginBottom: 6 },
  optionOn: { borderColor: "#C9A227", backgroundColor: "#FFFBEB" },
  optionText: { fontSize: 13, color: "#1B2A4A" },
  error: { color: "#DC2626", fontSize: 13, marginBottom: 8 },
  payButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  payButtonDisabled: { opacity: 0.5 },
  payButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 15 },
  chatButton: { backgroundColor: "#1B2A4A", borderRadius: 8, paddingVertical: 12, alignItems: "center", marginTop: 16, marginBottom: 8 },
  chatButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  lister: { marginTop: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  topBadge: { alignSelf: "flex-start", backgroundColor: "#C9A227", color: "#1B2A4A", fontSize: 11, fontWeight: "700", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginTop: 6, overflow: "hidden" },
  offerActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  offerButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
  danger: { color: "#B91C1C", fontWeight: "600", textDecorationLine: "underline", fontSize: 13 },
});
