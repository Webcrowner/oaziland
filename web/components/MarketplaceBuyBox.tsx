"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  checkMarketplaceCoupon, getMyProfile, getMyKycStatus, placeMarketplaceOrder, setMarketplaceCartItem,
  type GoodsVariant, type MarketplaceCategory, type MarketplaceOfferItem,
} from "@/lib/api";
import { notifyCartChanged } from "@/lib/cartEvents";
import { normalizeCouponCode } from "@/lib/coupons";
import {
  findVariant, isValueAvailable, lowStockCount, selectVariantValue, variantOptionNames, variantOptionValues, type VariantSelection,
} from "@/lib/goodsVariants";
import CompareAtPrice from "@/components/CompareAtPrice";
import MarketplaceOfferPanel from "@/components/MarketplaceOfferPanel";

type DeliveryMethod = "PICKUP" | "SELLER" | "COURIER";

/** What a goods listing offers at checkout: units in stock, the unit price, and how the buyer can get it. */
export interface GoodsCheckout {
  stock: number;
  unitPriceXaf: number;
  /** The seller's display-only "was" price. */
  compareAtXaf?: string | null;
  /** The versions of an item with options; the buyer must pick one before paying. */
  variants?: GoodsVariant[];
  options: { method: DeliveryMethod; feeXaf: number; note?: string }[];
}

/** Pay for a marketplace listing into escrow; the seller is only paid once the buyer confirms receipt. Goods also
 * choose how many and how to receive them; the total shown is what the server charges (price × quantity + delivery). */
export default function MarketplaceBuyBox({
  category, listingId, ownerId, availability, isSale, amount, goods, askingXaf, depositXaf = 0, allowOffers = false, sellerOnVacation = false,
}: {
  category: MarketplaceCategory;
  listingId: string;
  ownerId?: string;
  availability: string;
  isSale: boolean;
  amount: string;
  goods?: GoodsCheckout;
  askingXaf?: number;
  depositXaf?: number;
  allowOffers?: boolean;
  sellerOnVacation?: boolean;
}) {
  const t = useTranslations("MarketplaceBuyBox");
  const tcart = useTranslations("MarketplaceCart");
  const locale = useLocale();
  const [offer, setOffer] = useState<MarketplaceOfferItem | null>(null);
  // Once the seller accepts, the buyer pays the agreed price (one unit for goods) instead of the asking price.
  const agreed = offer?.status === "ACCEPTED" ? Number(offer.agreed_amount_xaf ?? offer.amount_xaf) : null;
  const [pickedQuantity, setQuantity] = useState(1);
  const [selection, setSelection] = useState<VariantSelection>({});
  const variants = goods?.variants && goods.variants.length > 0 ? goods.variants : null;
  const optionNames = variants ? variantOptionNames(variants) : [];
  const selected = variants ? findVariant(variants, selection) : null;
  const needsVariant = variants !== null && !selected;
  const unitPrice = selected ? Number(selected.price_xaf) : goods?.unitPriceXaf ?? 0;
  const stock = variants ? selected?.quantity ?? 0 : goods?.stock ?? 0;
  const quantity = agreed !== null ? 1 : Math.max(1, Math.min(pickedQuantity, stock || 1));
  const [method, setMethod] = useState<DeliveryMethod | "">(goods?.options.length === 1 ? goods.options[0].method : "");
  const [address, setAddress] = useState("");
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; discountXaf: number } | null>(null);
  const [couponMessage, setCouponMessage] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);
  const [cartState, setCartState] = useState<"idle" | "adding" | "added">("idle");
  const [cartError, setCartError] = useState("");
  const chosen = goods?.options.find((o) => o.method === method);
  const couponDiscount = goods && agreed === null && coupon ? Math.min(coupon.discountXaf, unitPrice * quantity) : 0;
  const goodsTotal = goods ? Math.max(0, (agreed ?? unitPrice) * quantity - couponDiscount) + (chosen?.feeXaf ?? 0) : 0;
  const payAmount = goods ? new Intl.NumberFormat(locale).format(goodsTotal) : agreed !== null ? new Intl.NumberFormat(locale).format(agreed + depositXaf) : amount;
  const router = useRouter();
  const [state, setState] = useState<"loading" | "signedOut" | "owner" | "needsKyc" | "buyer">("loading");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [placed, setPlaced] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    // Paying needs submitted identity (KYC) details, so we check up front instead of failing at the pay button.
    const lookup: Promise<"owner" | "needsKyc" | "buyer" | "signedOut"> = token
      ? getMyProfile(token)
        .then(async (profile) => {
          if (profile.id === ownerId) return "owner" as const;
          const kyc = await getMyKycStatus(token).catch(() => "unknown" as const);
          return kyc === null ? ("needsKyc" as const) : ("buyer" as const);
        })
        .catch(() => "signedOut" as const)
      : Promise.resolve("signedOut" as const);
    lookup.then(setState);
  }, [ownerId]);

  if (state === "loading") return null;
  if (state === "owner") {
    return (
      <div className="rounded-lg p-4 bg-gray-50 border border-gray-200 text-sm text-gray-700">
        <p className="mb-2">{t("yourListing")}</p>
        <Link href="/marketplace/my-listings" className="font-semibold text-[var(--navy)] underline">{t("manageListing")}</Link>
      </div>
    );
  }
  if (sellerOnVacation) {
    return (
      <div role="status" className="rounded-lg p-4 bg-amber-50 border border-amber-200 text-sm text-amber-900">
        <p className="font-semibold mb-1">{t("sellerOnVacationTitle")}</p>
        <p>{t("sellerOnVacationBody")}</p>
      </div>
    );
  }
  if (state === "needsKyc" && availability === "AVAILABLE") {
    return (
      <div className="rounded-lg p-4 bg-amber-50 border border-amber-200 text-sm text-amber-900">
        <p className="mb-2">{t("kycNeeded")}</p>
        <Link href="/kyc" className="font-bold underline">{t("kycLink")}</Link>
      </div>
    );
  }
  if (placed) {
    return (
      <div className="rounded-lg p-4 bg-green-50 border border-green-200 text-sm text-green-800">
        <p className="font-semibold mb-1">{t("placedTitle")}</p>
        <p className="mb-2">{t("placedBody")}</p>
        <Link href="/marketplace/orders" className="font-semibold text-[var(--navy)] underline">{t("viewOrders")}</Link>
      </div>
    );
  }
  if (availability !== "AVAILABLE") {
    return <div className="rounded-lg p-4 bg-gray-50 border border-gray-200 text-sm text-gray-700">{t("notAvailable")}</div>;
  }

  function changeQuantity(next: number) {
    setQuantity(next);
    if (coupon) void checkCoupon(coupon.code, next);
  }

  async function checkCoupon(rawCode: string, qty: number) {
    const token = localStorage.getItem("access_token");
    const code = normalizeCouponCode(rawCode);
    if (!token || !code) return;
    setCouponBusy(true);
    setCouponMessage("");
    try {
      const result = await checkMarketplaceCoupon(listingId, qty, code, token);
      setCoupon(result.valid ? { code: result.code || code, discountXaf: Number(result.discount_xaf) } : null);
      setCouponMessage(result.valid ? "" : result.message || t("couponInvalid"));
    } catch (err) {
      setCoupon(null);
      setCouponMessage(err instanceof Error ? err.message : t("couponFailed"));
    } finally {
      setCouponBusy(false);
    }
  }

  function removeCoupon() {
    setCoupon(null);
    setCouponInput("");
    setCouponMessage("");
  }

  async function addToCart() {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setCartState("adding");
    setCartError("");
    try {
      await setMarketplaceCartItem(listingId, quantity, token, selected?.id);
      setCartState("added");
      notifyCartChanged();
    } catch (err) {
      setCartState("idle");
      setCartError(err instanceof Error ? err.message : tcart("addFailed"));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      await placeMarketplaceOrder(
        category, listingId, phone.trim(), token, undefined,
        goods ? { quantity, ...(selected ? { variant_id: selected.id } : {}), ...(method ? { delivery_method: method } : {}), ...(method && method !== "PICKUP" ? { delivery_address: address.trim() } : {}) } : undefined,
        agreed !== null ? offer?.id : undefined,
        goods && agreed === null && coupon ? { coupon_code: coupon.code } : undefined,
      );
      setPlaced(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg p-4 bg-white border border-[var(--gold)]">
      <h2 className="font-bold text-[var(--navy)] mb-1">{isSale ? t("buyTitle") : t("rentTitle")}</h2>
      <p className="text-xs text-gray-600 mb-3">{t("escrowExplainer")}</p>
      {state === "signedOut" ? (
        <Link href="/login" className="inline-block bg-[var(--navy)] text-white font-semibold px-4 py-2 rounded-lg text-sm">{t("signIn")}</Link>
      ) : (
        <>
        {askingXaf !== undefined && (
          <MarketplaceOfferPanel category={category} listingId={listingId} askingXaf={askingXaf} allowOffers={allowOffers} onChange={setOffer} />
        )}
        <form onSubmit={submit} className="flex flex-col gap-2">
          {goods && (
            <>
              {variants && agreed === null && (
                <div className="flex flex-col gap-3 text-sm text-gray-700">
                  {optionNames.map((name) => (
                    <fieldset key={name} className="min-w-0">
                      <legend className="mb-1.5 font-semibold">{name}</legend>
                      <div className="flex flex-wrap gap-2">
                        {variantOptionValues(variants, name).map((value) => {
                          const inStock = isValueAvailable(variants, name, value);
                          const active = selection[name] === value;
                          return (
                            <button
                              key={value} type="button" disabled={!inStock} aria-pressed={active}
                              onClick={() => { setSelection(selectVariantValue(variants, selection, name, value)); setCartState("idle"); }}
                              className={`min-h-10 min-w-10 rounded-lg border px-3 py-1.5 text-sm font-semibold ${
                                active ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-slate-300 bg-white text-slate-800"
                              } ${inStock ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
                            >
                              <span className={inStock ? "" : "line-through"}>{value}</span>
                              {!inStock && <span className="block text-[10px] font-medium leading-tight no-underline">{t("outOfStock")}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                  ))}
                  {selected ? (
                    <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-2.5">
                      {selected.photo_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={selected.photo_url} alt={selected.label} className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                      )}
                      <div className="min-w-0">
                        <p className="break-words font-semibold text-slate-900">{selected.label}</p>
                        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="font-bold text-[var(--navy)]">{new Intl.NumberFormat(locale).format(unitPrice)} XAF</span>
                          <CompareAtPrice compareAtXaf={goods.compareAtXaf} shownPrice={unitPrice} compact />
                        </p>
                        <p className={`text-xs ${selected.quantity <= 0 ? "font-semibold text-red-700" : lowStockCount(selected.quantity) ? "font-semibold text-amber-700" : "text-gray-500"}`}>
                          {selected.quantity <= 0
                            ? t("outOfStock")
                            : lowStockCount(selected.quantity) ? t("onlyLeft", { count: selected.quantity }) : t("inStock", { count: selected.quantity })}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p role="status" className="text-xs font-semibold text-amber-800">{t("chooseOptions", { options: optionNames.join(" / ") })}</p>
                  )}
                </div>
              )}
              {agreed === null && (!variants || selected) && (
              <label className="flex items-center justify-between gap-2 text-sm text-gray-700">
                <span>
                  {t("quantity")}
                  {!variants && (
                    <span className="ml-1 text-xs text-gray-500">
                      {lowStockCount(stock) ? t("onlyLeft", { count: stock }) : t("inStock", { count: stock })}
                    </span>
                  )}
                </span>
                <input
                  type="number"
                  min={1}
                  max={stock}
                  step={1}
                  required
                  value={quantity}
                  onChange={(e) => changeQuantity(Math.min(stock, Math.max(1, Math.floor(Number(e.target.value) || 1))))}
                  className="w-24 min-h-10 border rounded-lg px-2 py-1.5 text-sm text-right"
                />
              </label>
              )}
              {goods.options.length > 0 && (
                <fieldset className="flex flex-col gap-1 text-sm text-gray-700">
                  <legend className="mb-1 font-semibold">{t("deliveryLegend")}</legend>
                  {goods.options.map((o) => (
                    <label key={o.method} className="flex items-start gap-2">
                      <input type="radio" name="delivery" required checked={method === o.method} onChange={() => setMethod(o.method)} className="mt-1" />
                      <span>
                        {t(`delivery_${o.method}`)}
                        {o.feeXaf > 0 ? ` · ${new Intl.NumberFormat(locale).format(o.feeXaf)} XAF` : ` · ${t("free")}`}
                        {o.note && <span className="block text-xs text-gray-500">{o.note}</span>}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              {method && method !== "PICKUP" && (
                <input
                  required
                  minLength={5}
                  maxLength={300}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder={t("addressPlaceholder")}
                  aria-label={t("addressPlaceholder")}
                  className="border rounded-lg px-3 py-2 text-sm"
                />
              )}
              {agreed === null && (
                <div className="text-sm text-gray-700">
                  <button
                    type="button" onClick={() => setCouponOpen((open) => !open)} aria-expanded={couponOpen}
                    className="min-h-10 font-semibold text-[var(--navy)] underline cursor-pointer"
                  >
                    {t("haveCoupon")}
                  </button>
                  {couponOpen && (
                    <div className="mt-1 flex flex-col gap-1.5">
                      {coupon ? (
                        <p className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-green-50 px-3 py-2 text-green-800">
                          <span>{t("couponApplied", { code: coupon.code, amount: new Intl.NumberFormat(locale).format(couponDiscount) })}</span>
                          <button type="button" onClick={removeCoupon} className="min-h-10 font-semibold underline cursor-pointer">{t("couponRemove")}</button>
                        </p>
                      ) : (
                        <div className="flex gap-2">
                          <input
                            value={couponInput}
                            onChange={(e) => setCouponInput(normalizeCouponCode(e.target.value))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void checkCoupon(couponInput, quantity);
                              }
                            }}
                            maxLength={30}
                            autoCapitalize="characters"
                            placeholder={t("couponPlaceholder")}
                            aria-label={t("couponPlaceholder")}
                            className="min-w-0 flex-1 border rounded-lg px-3 py-2 text-sm uppercase"
                          />
                          <button
                            type="button" onClick={() => checkCoupon(couponInput, quantity)} disabled={couponBusy || couponInput.length < 3}
                            className="min-h-10 shrink-0 rounded-lg border border-[var(--navy)] px-4 text-sm font-semibold text-[var(--navy)] disabled:opacity-50 cursor-pointer"
                          >
                            {couponBusy ? t("couponChecking") : t("couponApply")}
                          </button>
                        </div>
                      )}
                      <p role="status" className="text-red-700">{couponMessage}</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          <input
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t("phonePlaceholder")}
            aria-label={t("phonePlaceholder")}
            className="border rounded-lg px-3 py-2 text-sm"
          />
          {error && <p className="text-sm text-red-700">{error}</p>}
          {goods && couponDiscount > 0 && (
            <p className="text-xs text-green-700">{t("discountLine", { amount: new Intl.NumberFormat(locale).format(couponDiscount) })}</p>
          )}
          <button
            type="submit"
            disabled={busy || !phone.trim() || needsVariant || Boolean(selected && selected.quantity <= 0) || Boolean(goods && goods.options.length > 0 && !method)}
            className="min-h-11 bg-[var(--navy)] text-white font-semibold px-4 py-2.5 rounded-lg text-sm disabled:opacity-50 cursor-pointer"
          >
            {busy ? t("paying") : t("payButton", { amount: payAmount })}
          </button>
          {goods && agreed === null && state === "buyer" && (
            <>
              <button
                type="button" onClick={addToCart} disabled={cartState === "adding" || needsVariant || Boolean(selected && selected.quantity <= 0)}
                className="min-h-11 border border-[var(--navy)] text-[var(--navy)] font-semibold px-4 py-2.5 rounded-lg text-sm disabled:opacity-50 cursor-pointer"
              >
                {cartState === "adding" ? tcart("adding") : tcart("addToCart")}
              </button>
              {cartState === "added" && (
                <p role="status" className="text-sm text-green-700">
                  {tcart("added")} <Link href="/marketplace/cart" className="font-semibold underline">{tcart("viewCart")}</Link>
                </p>
              )}
              {cartError && <p role="alert" className="text-sm text-red-700">{cartError}</p>}
            </>
          )}
        </form>
        </>
      )}
    </div>
  );
}
