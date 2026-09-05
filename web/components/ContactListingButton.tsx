"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { contactListing } from "@/lib/api";

/**
 * The real WhatsApp contact button — a client-side island inside an
 * otherwise server-rendered detail page, since contacting requires an
 * authenticated POST request (property.views.ListingViewSet.contact).
 * Not logged in → sent to sign in first, matching the platform-wide
 * rule that VIEWING is public but ACTING requires an account.
 */
export default function ContactListingButton({ listingId }: { listingId: string }) {
  const t = useTranslations("ListingDetailPage");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleContact() {
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

  return (
    <div>
      <button
        onClick={handleContact}
        disabled={loading}
        className="bg-[#C9A227] text-[#1B2A4A] font-semibold px-6 py-3 rounded hover:opacity-90 disabled:opacity-50"
      >
        {loading ? t("contacting") : t("contactOnWhatsApp")}
      </button>
      {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
    </div>
  );
}
