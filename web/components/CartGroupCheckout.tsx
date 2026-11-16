"use client";
import { useEffect, useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  checkoutMarketplaceCart, quoteMarketplaceCart, removeMarketplaceCartItem, setMarketplaceCartItem,
  type MarketplaceCart, type MarketplaceCartGroup, type MarketplaceCartItem, type MarketplaceCartQuote, type MarketplaceCartRequest,
} from "@/lib/api";
import { notifyCartChanged } from "@/lib/cartEvents";
import { normalizeCouponCode } from "@/lib/coupons";
import SaleCountdown from "@/components/SaleCountdown";

type Method = MarketplaceCartRequest["delivery_method"];
type QuoteResult = { key: string; quote?: MarketplaceCartQuote; error?: string };

/** One cart line is one listing + one version of it, so both are part of its key. */
const lineKey = (item: Pick<MarketplaceCartItem, "listing_id" | "variant_id">) => `${item.listing_id}:${item.variant_id ?? ""}`;

/** One seller's part of the cart: its items with quantity controls, and the checkout panel (delivery, coupon, one payment). */
export default function CartGroupCheckout({
  group, kycNeeded, onCart, onPlaced,
}: {
  group: MarketplaceCartGroup;
  kycNeeded: boolean;
  onCart: (cart: MarketplaceCart) => void;
  onPlaced: (info: { totalXaf: string }) => void;
}) {
  const t = useTranslations("MarketplaceCart");
  const tb = useTranslations("MarketplaceBuyBox");
  const format = useFormatter();
  const money = (value: string | number) => format.number(Number(value));

  const [busyListing, setBusyListing] = useState("");
  const [lineError, setLineError] = useState("");
  const [method, setMethod] = useState<Method | "">(group.delivery_options.length === 1 ? group.delivery_options[0].method : "");
  const [address, setAddress] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [phone, setPhone] = useState("");
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");
  const [result, setResult] = useState<QuoteResult | null>(null);

  const activeMethod = group.delivery_options.some((o) => o.method === method) ? method : "";
  const needsAddress = activeMethod !== "" && activeMethod !== "PICKUP";
  const trimmedAddress = address.trim();
  const itemsKey = group.items.map((item) => `${lineKey(item)}:${item.quantity}`).join(",");
  const request = useMemo<MarketplaceCartRequest | null>(() => (activeMethod
    ? {
      seller_id: group.seller_id, delivery_method: activeMethod,
      ...(needsAddress && trimmedAddress.length >= 5 ? { delivery_address: trimmedAddress } : {}),
      ...(couponCode ? { coupon_code: couponCode } : {}),
    }
    : null), [group.seller_id, activeMethod, needsAddress, trimmedAddress, couponCode]);
  const requestKey = request ? `${JSON.stringify(request)}|${itemsKey}` : "";
  const current = result && result.key === requestKey ? result : null;
  const quote = current?.quote;
  const canPay = group.can_checkout && Boolean(request) && Boolean(quote) && (!needsAddress || trimmedAddress.length >= 5) && phone.trim().length > 0;

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!request || !token) return;
    let stale = false;
    const timer = setTimeout(() => {
      quoteMarketplaceCart(request, token)
        .then((quoted) => { if (!stale) setResult({ key: requestKey, quote: quoted }); })
        .catch((err: unknown) => { if (!stale) setResult({ key: requestKey, error: err instanceof Error ? err.message : t("quoteFailed") }); });
    }, 350);
    return () => { stale = true; clearTimeout(timer); };
  }, [request, requestKey, t]);

  async function changeLine(key: string, action: () => Promise<MarketplaceCart>) {
    setBusyListing(key);
    setLineError("");
    try {
      onCart(await action());
      notifyCartChanged();
    } catch (err) {
      setLineError(err instanceof Error ? err.message : t("updateFailed"));
    } finally {
      setBusyListing("");
    }
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || !request) return;
    setPaying(true);
    setPayError("");
    try {
      const placed = await checkoutMarketplaceCart({ ...request, phone_number: phone.trim() }, token);
      notifyCartChanged();
      onPlaced({ totalXaf: placed.total_xaf });
    } catch (err) {
      setPayError(err instanceof Error ? err.message : t("checkoutFailed"));
    } finally {
      setPaying(false);
    }
  }

  const summary = useMemo(() => ({
    subtotal: quote ? Number(quote.subtotal_xaf) : Number(group.subtotal_xaf),
    discount: quote ? Number(quote.discount_xaf) : 0,
    fee: quote ? Number(quote.delivery_fee_xaf) : 0,
  }), [quote, group.subtotal_xaf]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4" aria-label={t("fromSeller", { name: group.seller_name })}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="min-w-0 text-base font-bold text-[var(--navy)]">{t("fromSeller", { name: group.seller_name })}</h2>
        <Link href={`/marketplace/shop/${group.seller_id}`} className="inline-flex min-h-10 items-center text-sm font-semibold text-[var(--navy)] underline">{t("viewShop")}</Link>
      </div>

      <div className="lg:grid lg:grid-cols-5 lg:gap-6">
        <ul className="flex flex-col divide-y divide-slate-100 lg:col-span-3">
          {group.items.map((item) => {
            const busy = busyListing === lineKey(item);
            return (
              <li key={lineKey(item)} className="flex gap-3 py-3 first:pt-0">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100 sm:h-20 sm:w-20">
                  {item.photo_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.photo_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={`/marketplace/goods/${item.listing_id}`} className="line-clamp-2 break-words text-sm font-semibold text-slate-800 hover:underline">{item.title}</Link>
                  {item.variant_label && <p className="break-words text-xs font-medium text-slate-600">{item.variant_label}</p>}
                  <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-bold text-[var(--navy)]">{money(item.unit_price_xaf)} XAF</span>
                    {item.on_sale && <span className="text-xs text-slate-400 line-through">{money(item.list_price_xaf)}</span>}
                  </p>
                  {item.on_sale && item.sale_ends_at && <SaleCountdown endsAt={item.sale_ends_at} className="text-xs font-semibold text-red-700" />}
                  {!item.available && (
                    <p role="alert" className="mt-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900">
                      {t("unavailable")}{item.reason ? `: ${item.reason}` : ""}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <div className="inline-flex items-center overflow-hidden rounded-lg border border-slate-300" role="group" aria-label={t("quantityFor", { title: item.title })}>
                      <button
                        type="button" disabled={busy || item.quantity <= 1}
                        onClick={() => changeLine(lineKey(item), () => setMarketplaceCartItem(item.listing_id, item.quantity - 1, localStorage.getItem("access_token") ?? "", item.variant_id))}
                        aria-label={t("decrease", { title: item.title })}
                        className="h-10 w-10 text-lg font-bold text-[var(--navy)] disabled:opacity-40 cursor-pointer"
                      >
                        −
                      </button>
                      <span className="min-w-8 px-1 text-center text-sm font-semibold tabular-nums" aria-live="polite">{item.quantity}</span>
                      <button
                        type="button" disabled={busy || (item.stock > 0 && item.quantity >= item.stock)}
                        onClick={() => changeLine(lineKey(item), () => setMarketplaceCartItem(item.listing_id, item.quantity + 1, localStorage.getItem("access_token") ?? "", item.variant_id))}
                        aria-label={t("increase", { title: item.title })}
                        className="h-10 w-10 text-lg font-bold text-[var(--navy)] disabled:opacity-40 cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button" disabled={busy}
                      onClick={() => changeLine(lineKey(item), () => removeMarketplaceCartItem(item.listing_id, localStorage.getItem("access_token") ?? "", item.variant_id))}
                      aria-label={t("removeItem", { title: item.title })}
                      className="min-h-10 text-sm font-semibold text-red-700 underline disabled:opacity-50 cursor-pointer"
                    >
                      {t("remove")}
                    </button>
                    <span className="ml-auto text-sm font-bold text-slate-800">{money(item.line_total_xaf)} XAF</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{t("stockLeft", { count: item.stock })}</p>
                </div>
              </li>
            );
          })}
          {lineError && <li role="alert" className="py-2 text-sm text-red-700">{lineError}</li>}
        </ul>

        <form onSubmit={pay} className="mt-3 flex flex-col gap-3 rounded-xl bg-slate-50 p-3 lg:col-span-2 lg:mt-0">
          {!group.can_checkout && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("cannotCheckout")}</p>}

          {group.delivery_options.length > 0 && (
            <fieldset className="flex flex-col gap-1 text-sm text-gray-700">
              <legend className="mb-1 font-semibold">{tb("deliveryLegend")}</legend>
              {group.delivery_options.map((option) => (
                <label key={option.method} className="flex min-h-10 items-center gap-2">
                  <input type="radio" name={`delivery-${group.seller_id}`} required checked={activeMethod === option.method} onChange={() => setMethod(option.method)} />
                  <span>
                    {tb(`delivery_${option.method}`)}
                    {Number(option.fee_xaf) > 0 ? ` · ${money(option.fee_xaf)} XAF` : ` · ${tb("free")}`}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {needsAddress && (
            <input
              required minLength={5} maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)}
              placeholder={tb("addressPlaceholder")} aria-label={tb("addressPlaceholder")}
              className="min-h-11 rounded-lg border px-3 py-2 text-sm"
            />
          )}

          <div className="flex flex-col gap-1.5">
            {couponCode ? (
              <p className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-700">
                <span>{t("couponUsing", { code: couponCode })}</span>
                <button type="button" onClick={() => { setCouponCode(""); setCouponInput(""); }} className="min-h-10 font-semibold text-[var(--navy)] underline cursor-pointer">{t("couponRemove")}</button>
              </p>
            ) : (
              <div className="flex gap-2">
                <input
                  value={couponInput} onChange={(e) => setCouponInput(normalizeCouponCode(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (couponInput.length >= 3) setCouponCode(couponInput);
                    }
                  }}
                  maxLength={30} autoCapitalize="characters" placeholder={t("couponPlaceholder")} aria-label={t("couponPlaceholder")}
                  className="min-h-11 min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm uppercase"
                />
                <button
                  type="button" disabled={couponInput.length < 3 || !activeMethod} onClick={() => setCouponCode(couponInput)}
                  className="min-h-11 shrink-0 rounded-lg border border-[var(--navy)] px-4 text-sm font-semibold text-[var(--navy)] disabled:opacity-50 cursor-pointer"
                >
                  {t("couponApply")}
                </button>
              </div>
            )}
            {!activeMethod && !couponCode && <p className="text-xs text-slate-500">{t("couponNeedsDelivery")}</p>}
            {quote?.coupon_error && <p role="status" className="text-sm text-red-700">{quote.coupon_error}</p>}
          </div>

          <dl className="flex flex-col gap-1 text-sm text-slate-700" aria-live="polite">
            <div className="flex justify-between gap-3"><dt>{t("subtotal")}</dt><dd className="font-semibold">{money(summary.subtotal)} XAF</dd></div>
            {quote && summary.discount > 0 && (
              <div className="flex justify-between gap-3 text-green-700"><dt>{t("discountLine")}</dt><dd className="font-semibold">−{money(summary.discount)} XAF</dd></div>
            )}
            {quote && (
              <div className="flex justify-between gap-3"><dt>{t("deliveryLine")}</dt><dd className="font-semibold">{summary.fee > 0 ? `${money(summary.fee)} XAF` : tb("free")}</dd></div>
            )}
            {quote && (
              <div className="mt-1 flex justify-between gap-3 border-t border-slate-200 pt-2 text-base font-bold text-[var(--navy)]"><dt>{t("total")}</dt><dd>{money(quote.total_xaf)} XAF</dd></div>
            )}
          </dl>
          {!activeMethod && group.delivery_options.length > 0 && <p className="text-xs text-slate-500">{t("chooseDelivery")}</p>}
          {current?.error && <p role="alert" className="text-sm text-red-700">{current.error}</p>}

          {kycNeeded ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="mb-2">{tb("kycNeeded")}</p>
              <Link href="/kyc" className="font-bold underline">{tb("kycLink")}</Link>
            </div>
          ) : (
            <>
              <input
                type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder={tb("phonePlaceholder")} aria-label={tb("phonePlaceholder")}
                className="min-h-11 rounded-lg border px-3 py-2 text-sm"
              />
              {payError && <p role="alert" className="text-sm text-red-700">{payError}</p>}
              <button
                type="submit" disabled={paying || !canPay}
                className="min-h-11 rounded-lg bg-[var(--navy)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 cursor-pointer"
              >
                {paying ? t("paying") : quote ? t("pay", { amount: money(quote.total_xaf) }) : t("payDisabled")}
              </button>
              <p className="text-xs text-slate-500">{t("payExplainer")}</p>
            </>
          )}
        </form>
      </div>
    </section>
  );
}
