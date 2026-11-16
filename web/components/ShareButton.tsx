"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { getListingShareMessage } from "@/lib/api";
import { IconCheckCircle, IconCopy, IconFacebook, IconShare, IconWhatsApp, IconX } from "./Icons";

const DEFAULT_TEMPLATE = "Check out this {title} in {location} for {price} XAF on Oaziland: {link}";

function buildMessage(template: string, values: Record<string, string>): string {
  // Cards without a price (e.g. a venue) drop the "for {price} XAF" phrase.
  const noPrice = values.price ? template : template.replace(/\s*for\s*\{price\}\s*XAF/i, "");
  const base = values.location ? noPrice : noPrice.replace(/\s*in\s*\{location\}/i, "");
  const filled = Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(value), base);
  // Admin templates may omit {link}; the link must always be shared.
  return template.includes("{link}") ? filled : `${filled} ${values.link}`;
}

interface ShareButtonProps {
  title: string;
  location: string;
  price?: string;
  /** Locale-less path to share, e.g. "/listing/123" or "/hotels/abc?room=xyz". */
  path: string;
  /** overlay: round button on a card photo; inline: round button; detail: full-width button; dialog: round button on a pop-up photo. */
  variant?: "overlay" | "inline" | "detail" | "dialog";
}

type Shared = { message: string; text: string; link: string };

/** Shares a card or page: the device's own share sheet (every installed app) where the browser offers one,
 * otherwise a menu of the usual apps plus copy link. */
export default function ShareButton({ title, location, price = "", path, variant = "inline" }: ShareButtonProps) {
  const t = useTranslations("PropertyCard");
  const locale = useLocale();
  const [menu, setMenu] = useState<Shared | null>(null);

  async function handleShare(e: React.MouseEvent) {
    e.preventDefault(); // stop a surrounding card <Link> from navigating
    e.stopPropagation();
    const template = await getListingShareMessage().catch(() => DEFAULT_TEMPLATE);
    const link = `${window.location.origin}/${locale}${path}`;
    const shared = {
      message: buildMessage(template, { title, location, price, link }),
      text: buildMessage(template, { title, location, price, link: "" }).replace(/[\s:]+$/, ""),
      link,
    };
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Oaziland", text: shared.text, url: link });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return; // the user closed the share sheet
      }
    }
    setMenu(shared);
  }

  const icon = <IconShare size={variant === "detail" ? 18 : 16} />;
  const button =
    variant === "detail" ? (
      <button
        type="button"
        onClick={handleShare}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm bg-[var(--navy)] text-white hover:opacity-90 transition-opacity"
      >
        {icon}
        {t("share")}
      </button>
    ) : (
      <button
        type="button"
        onClick={handleShare}
        aria-label={t("share")}
        title={t("share")}
        className={`w-9 h-9 rounded-full flex items-center justify-center bg-white/95 text-[var(--navy)] shadow hover:bg-white transition-colors ${
          variant === "overlay" ? "absolute top-2 right-2" : variant === "dialog" ? "absolute left-3 top-3" : "shrink-0"
        }`}
      >
        {icon}
      </button>
    );

  return (
    <>
      {button}
      {menu && createPortal(<ShareMenu shared={menu} onClose={() => setMenu(null)} />, document.body)}
    </>
  );
}

function ShareMenu({ shared, onClose }: { shared: Shared; onClose: () => void }) {
  const t = useTranslations("PropertyCard");
  const [copied, setCopied] = useState(false);
  const text = encodeURIComponent(shared.message);
  const link = encodeURIComponent(shared.link);
  const targets = [
    { key: "WhatsApp", href: `https://wa.me/?text=${text}`, icon: <IconWhatsApp size={18} />, tone: "bg-[#25D366] text-white" },
    { key: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${link}`, icon: <IconFacebook size={18} />, tone: "bg-white text-slate-800 border border-slate-200" },
    { key: "Telegram", href: `https://t.me/share/url?url=${link}&text=${encodeURIComponent(shared.text)}`, icon: <span aria-hidden className="text-base">✈️</span>, tone: "bg-[#229ED9] text-white" },
    { key: "X", href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shared.text)}&url=${link}`, icon: <span aria-hidden className="font-black">𝕏</span>, tone: "bg-black text-white" },
    { key: t("shareEmail"), href: `mailto:?subject=${encodeURIComponent("Oaziland")}&body=${text}`, icon: <span aria-hidden>✉️</span>, tone: "bg-slate-100 text-slate-800" },
    { key: t("shareSms"), href: `sms:?&body=${text}`, icon: <span aria-hidden>💬</span>, tone: "bg-slate-100 text-slate-800" },
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(shared.link);
      setCopied(true);
    } catch {
      window.prompt(t("copyLink"), shared.link);
    }
  }

  return (
    // Events from a portal still bubble through the React tree, so a card <Link> around the button would navigate.
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-950/60 p-4"
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-menu-title"
        className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 id="share-menu-title" className="text-base font-black text-[var(--navy)]">{t("shareVia")}</h3>
          <button type="button" onClick={onClose} aria-label={t("close")} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <IconX size={18} />
          </button>
        </div>
        <ul className="mt-4 grid grid-cols-3 gap-3">
          {targets.map((target) => (
            <li key={target.key}>
              <a
                href={target.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onClose}
                className="flex flex-col items-center gap-1.5 rounded-xl p-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                <span className={`flex h-11 w-11 items-center justify-center rounded-full ${target.tone}`}>{target.icon}</span>
                {target.key}
              </a>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
          <input readOnly value={shared.link} aria-label={t("copyLink")} className="min-w-0 flex-1 bg-transparent px-1 font-mono text-xs text-slate-600 outline-none" />
          <button
            type="button"
            onClick={copy}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-slate-800 shadow-sm hover:bg-slate-100"
          >
            {copied ? <IconCheckCircle size={14} className="text-emerald-600" /> : <IconCopy size={14} />}
            {copied ? t("linkCopied") : t("copyLink")}
          </button>
        </div>
      </div>
    </div>
  );
}
