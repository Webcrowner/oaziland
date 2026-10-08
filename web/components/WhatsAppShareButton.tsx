"use client";
import { useLocale, useTranslations } from "next-intl";
import { getListingShareMessage } from "@/lib/api";
import { IconWhatsApp } from "./Icons";

const DEFAULT_TEMPLATE = "Check out this {title} in {location} for {price} XAF on Oaziland: {link}";

function buildMessage(template: string, values: Record<string, string>): string {
  // Cards without a price (e.g. a venue) drop the "for {price} XAF" phrase.
  const noPrice = values.price ? template : template.replace(/\s*for\s*\{price\}\s*XAF/i, "");
  const base = values.location ? noPrice : noPrice.replace(/\s*in\s*\{location\}/i, "");
  const filled = Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(value), base);
  // Admin templates may omit {link}; the link must always be shared.
  return template.includes("{link}") ? filled : `${filled} ${values.link}`;
}

interface WhatsAppShareButtonProps {
  title: string;
  location: string;
  price?: string;
  /** Locale-less path to share, e.g. "/listing/123" or "/hotels". */
  path: string;
  variant?: "overlay" | "inline" | "detail";
}

export default function WhatsAppShareButton({ title, location, price = "", path, variant = "inline" }: WhatsAppShareButtonProps) {
  const t = useTranslations("PropertyCard");
  const locale = useLocale();

  async function handleShare(e: React.MouseEvent) {
    e.preventDefault(); // stop a surrounding card <Link> from navigating
    e.stopPropagation();
    const template = await getListingShareMessage().catch(() => DEFAULT_TEMPLATE);
    const message = buildMessage(template, {
      title,
      location,
      price,
      link: `${window.location.origin}/${locale}${path}`,
    });
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }

  if (variant === "detail") {
    return (
      <button
        type="button"
        onClick={handleShare}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm bg-[#25D366] text-white hover:bg-[#1ebe5b] transition-colors"
      >
        <IconWhatsApp size={18} />
        {t("shareOnWhatsApp")}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      aria-label={t("shareOnWhatsApp")}
      title={t("shareOnWhatsApp")}
      className={`w-8 h-8 rounded-full flex items-center justify-center bg-[#25D366] text-white shadow hover:bg-[#1ebe5b] transition-colors ${
        variant === "overlay" ? "absolute top-2 right-2" : "shrink-0"
      }`}
    >
      <IconWhatsApp size={18} />
    </button>
  );
}
