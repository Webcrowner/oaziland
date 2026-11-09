"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { getOrCreateConversation, sendConversationMessage, type MarketplaceCategory } from "@/lib/api";

/** One-tap openers, like Jiji or Facebook Marketplace; each is a translation key per kind of listing. */
const QUICK_QUESTIONS: Record<"carSale" | "carRent" | "sale" | "rent", string[]> = {
  carSale: ["qAvailable", "qLastPrice", "qViewing", "qPapers", "qHistory"],
  carRent: ["qAvailableDates", "qPickup", "qDriver", "qDelivery", "qLongRental"],
  sale: ["qAvailable", "qLastPrice", "qViewing", "qCondition"],
  rent: ["qAvailable", "qViewing", "qTerms"],
};

/**
 * "Chat with the seller" for a marketplace listing: pick a ready question or write your own, and it is sent with a
 * card of the listing so the owner knows exactly which car or item it's about. Then the conversation opens.
 */
export default function ListingChatButton({
  category, listingId, recipientId, isSale, compact = false,
}: {
  category: MarketplaceCategory;
  listingId: string;
  /** The other person: the lister, or (from the seller's side of an order) the buyer. */
  recipientId: string;
  isSale: boolean;
  /** Just a button that opens the chat with the listing attached (e.g. on an order). */
  compact?: boolean;
}) {
  const t = useTranslations("ListingChat");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const kind = category === "cars" ? (isSale ? "carSale" : "carRent") : isSale ? "sale" : "rent";

  async function send(message: string) {
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    setSending(true);
    setError("");
    try {
      const conversation = await getOrCreateConversation(recipientId, token);
      await sendConversationMessage(conversation.id, message, token, listingId);
      router.push(`/messages?conversation=${conversation.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
      setSending(false);
    }
  }

  const buttonClass = "w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-amber-300 hover:bg-slate-800 disabled:opacity-50";

  if (compact) {
    return (
      <div>
        <button type="button" disabled={sending} onClick={() => send(t("compactOpener"))} className="text-sm font-semibold text-[var(--navy)] underline disabled:opacity-50">
          💬 {sending ? t("opening") : t("messageAboutThis")}
        </button>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClass}>
        💬 {category === "cars" ? (isSale ? t("chatSeller") : t("chatOwner")) : t("chatLister")}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <p className="font-semibold text-[var(--navy)]">{t("askTitle")}</p>
      <div className="flex flex-wrap gap-1.5">
        {QUICK_QUESTIONS[kind].map((key) => (
          <button
            key={key} type="button" onClick={() => setText(t(key))}
            className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:border-[var(--navy)]"
          >
            {t(key)}
          </button>
        ))}
      </div>
      <textarea
        rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000}
        placeholder={t("placeholder")} aria-label={t("placeholder")} className="rounded-lg border px-3 py-2"
      />
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="button" disabled={sending || !text.trim()} onClick={() => send(text.trim())} className={buttonClass}>
          {sending ? t("sending") : t("send")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="shrink-0 px-2 text-xs font-semibold text-slate-500">{t("cancel")}</button>
      </div>
      <p className="text-[11px] text-slate-500">{t("safetyTip")}</p>
    </div>
  );
}
