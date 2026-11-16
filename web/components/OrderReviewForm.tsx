"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { reviewMarketplaceOrder, type MarketplaceOrderItem } from "@/lib/api";
import StarRating from "@/components/StarRating";

/** The buyer's review of a completed order: stars and an optional comment, shown on the listing as a verified purchase. */
export default function OrderReviewForm({ order, onSaved }: { order: MarketplaceOrderItem; onSaved: () => void }) {
  const t = useTranslations("OrderReview");
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (order.my_review) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
        <p className="mb-1 text-sm font-semibold text-emerald-900">{t("yourReview")}</p>
        <StarRating value={order.my_review.score} />
        {order.my_review.text && <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{order.my_review.text}</p>}
      </div>
    );
  }
  if (!order.can_review) return null;
  if (!open) {
    return <button onClick={() => setOpen(true)} className="text-sm font-semibold text-[var(--navy)] underline cursor-pointer">★ {t("write")}</button>;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || !score) return;
    setBusy(true);
    setError("");
    try {
      await reviewMarketplaceOrder(order.id, score, text.trim(), token);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
      <p className="mb-1 text-sm font-semibold text-slate-800">{t("prompt", { title: order.listing_title })}</p>
      <div className="mb-2 flex gap-1" onMouseLeave={() => setHovered(0)}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star} type="button" onMouseEnter={() => setHovered(star)} onClick={() => setScore(star)}
            aria-label={t("starsLabel", { count: star })} aria-pressed={score === star}
            className={`text-3xl leading-none cursor-pointer transition-colors ${star <= (hovered || score) ? "text-amber-500" : "text-slate-300"}`}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3}
        placeholder={t("textPlaceholder")} aria-label={t("textPlaceholder")}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
      />
      {error && <p role="alert" className="mt-1 text-sm text-red-600">{error}</p>}
      <div className="mt-2 flex gap-3">
        <button disabled={busy || !score} className="rounded-xl bg-[var(--navy)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50 cursor-pointer">
          {busy ? t("saving") : t("submit")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm font-semibold text-slate-500 cursor-pointer">{t("cancel")}</button>
      </div>
    </form>
  );
}
