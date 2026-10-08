"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { contactListing, getOrCreateConversation } from "@/lib/api";

/**
 * Contact buttons for a listing:
 * 1. Direct WhatsApp deep link ("Contact on WhatsApp")
 * 2. In-app private direct message ("Chat on Oaziland") connecting to /messages
 */
export default function ContactListingButton({
  listingId,
  listerId,
}: {
  listingId: string;
  listerId?: string;
}) {
  const t = useTranslations("ListingDetailPage");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleContactWhatsApp() {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (!token) {
      router.push("/login");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await contactListing(listingId, token);
      window.open(result.deep_link, "_blank");
    } catch {
      setError(t("contactFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleDirectChat() {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (!token) {
      router.push("/login");
      return;
    }
    if (!listerId) {
      router.push("/messages");
      return;
    }
    setChatLoading(true);
    setError("");
    try {
      const conv = await getOrCreateConversation(listerId, token);
      router.push(`/messages?conversation=${conv.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open private chat");
    } finally {
      setChatLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleContactWhatsApp}
        disabled={loading || chatLoading}
        className="w-full bg-[var(--gold)] text-[var(--navy)] font-semibold px-6 py-3 rounded-xl hover:opacity-90 disabled:opacity-50 text-center transition-opacity"
      >
        {loading ? t("contacting") : t("contactOnWhatsApp")}
      </button>

      {listerId && (
        <button
          onClick={handleDirectChat}
          disabled={loading || chatLoading}
          className="w-full bg-[var(--navy)] text-white font-semibold px-6 py-3 rounded-xl hover:bg-slate-800 disabled:opacity-50 text-center flex items-center justify-center gap-2 transition-colors text-sm"
        >
          <span>💬</span>
          <span>{chatLoading ? t("openingChat") : t("chatDirectly")}</span>
        </button>
      )}

      {error && <p className="text-red-600 text-sm mt-1">{error}</p>}
    </div>
  );
}
