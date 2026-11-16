"use client";
import { useEffect, useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  OPEN_OFFER_STATUSES, listMyMarketplaceOffers, makeMarketplaceOffer, marketplaceOfferAction,
  type MarketplaceCategory, type MarketplaceOfferItem,
} from "@/lib/api";

/** The lowest offer the server accepts, as a share of the asking price (see MIN_OFFER_SHARE in marketplace/offers.py). */
export const MIN_OFFER_SHARE = 0.3;

/** The buyer's side of "Make an offer": propose a lower price, answer a counter-offer, or withdraw. Reports the
 * open offer to its parent so an accepted price can be paid at the agreed amount. */
export default function MarketplaceOfferPanel({
  category, listingId, askingXaf, allowOffers, onChange,
}: {
  category: MarketplaceCategory;
  listingId: string;
  askingXaf: number;
  allowOffers: boolean;
  onChange: (offer: MarketplaceOfferItem | null) => void;
}) {
  const t = useTranslations("MarketplaceOffers");
  const format = useFormatter();
  const locale = useLocale();
  const [offer, setOffer] = useState<MarketplaceOfferItem | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const money = (value: number | string) => `${new Intl.NumberFormat(locale).format(Number(value))} XAF`;
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const minOffer = Math.ceil(askingXaf * MIN_OFFER_SHARE);

  function apply(next: MarketplaceOfferItem | null) {
    setOffer(next);
    onChange(next);
  }

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    let cancelled = false;
    listMyMarketplaceOffers("buying", token, listingId)
      .then((data) => {
        if (cancelled) return;
        const current = data.results.find((o) => OPEN_OFFER_STATUSES.includes(o.status)) ?? null;
        setOffer(current);
        onChange(current);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
    // onChange is a parent setter; re-running on its identity would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  async function act(run: (token: string) => Promise<MarketplaceOfferItem>, after?: (next: MarketplaceOfferItem) => void) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      const next = await run(token);
      if (after) after(next);
      else apply(OPEN_OFFER_STATUSES.includes(next.status) ? next : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  if (offer) {
    return (
      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-semibold">{t(`status_${offer.status}`)}</p>
        <p className="mt-0.5">
          {offer.status === "COUNTERED"
            ? t("counterLine", { offered: money(offer.amount_xaf), counter: money(offer.counter_amount_xaf ?? 0) })
            : offer.status === "ACCEPTED"
              ? t("acceptedLine", { price: money(offer.agreed_amount_xaf ?? offer.amount_xaf) })
              : t("pendingLine", { offered: money(offer.amount_xaf) })}
        </p>
        {offer.status === "ACCEPTED" && offer.pay_by && <p className="mt-0.5 text-xs">{t("payBy", { date: when(offer.pay_by) })}</p>}
        {offer.status !== "ACCEPTED" && offer.respond_by && <p className="mt-0.5 text-xs">{t("respondBy", { date: when(offer.respond_by) })}</p>}
        {error && <p className="mt-1 text-red-700">{error}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {offer.status === "COUNTERED" && (
            <button
              type="button" disabled={busy} onClick={() => act((token) => marketplaceOfferAction(offer.id, "accept", token))}
              className="rounded-lg bg-[var(--navy)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer"
            >
              {t("acceptCounter", { price: money(offer.counter_amount_xaf ?? 0) })}
            </button>
          )}
          <button
            type="button" disabled={busy}
            onClick={() => { if (window.confirm(t("confirmWithdraw"))) act((token) => marketplaceOfferAction(offer.id, "withdraw", token)); }}
            className="text-xs font-semibold text-red-700 underline disabled:opacity-50 cursor-pointer"
          >
            {offer.status === "COUNTERED" ? t("declineCounter") : t("withdraw")}
          </button>
        </div>
      </div>
    );
  }

  if (!allowOffers) return null;

  if (!open) {
    return (
      <button
        type="button" onClick={() => setOpen(true)}
        className="mb-3 w-full rounded-lg border border-[var(--navy)] px-4 py-2 text-sm font-semibold text-[var(--navy)] cursor-pointer"
      >
        {t("makeOffer")}
      </button>
    );
  }

  const value = Number(amount);
  const valid = Number.isInteger(value) && value >= minOffer && value < askingXaf;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        act((token) => makeMarketplaceOffer(category, listingId, value, message.trim(), token), (next) => { apply(next); setOpen(false); setAmount(""); setMessage(""); });
      }}
      className="mb-3 flex flex-col gap-2 rounded-lg border border-slate-200 p-3"
    >
      <p className="text-sm font-semibold text-[var(--navy)]">{t("formTitle", { price: money(askingXaf) })}</p>
      <input
        type="number" inputMode="numeric" min={minOffer} max={askingXaf - 1} step={1} required
        value={amount} onChange={(e) => setAmount(e.target.value)}
        placeholder={t("amountPlaceholder")} aria-label={t("amountPlaceholder")}
        className="border rounded-lg px-3 py-2 text-sm"
      />
      <p className="text-xs text-gray-500">{t("amountHint", { min: money(minOffer) })}</p>
      <input
        maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)}
        placeholder={t("messagePlaceholder")} aria-label={t("messagePlaceholder")}
        className="border rounded-lg px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || !valid} className="rounded-lg bg-[var(--navy)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 cursor-pointer">
          {busy ? t("sending") : t("send")}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(""); }} className="text-sm font-semibold text-slate-500 cursor-pointer">{t("cancel")}</button>
      </div>
    </form>
  );
}
