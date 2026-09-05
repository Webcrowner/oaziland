"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { API_BASE_URL } from "@/lib/api";

/**
 * List a Property — Page 5 of Prompt 17. Posts directly to the
 * /api/listings/ endpoint (Prompt 16), which enforces MFA+KYC at the
 * permission layer — a landlord who hasn't completed those steps gets
 * a real 403 here, matching the platform-wide enforcement rule exactly
 * rather than a separate, looser check in the frontend.
 */
export default function ListPropertyPage() {
  const t = useTranslations("ListPropertyPage");
  const [listingType, setListingType] = useState("RENT");
  const [price, setPrice] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (!token) {
      setMessage({ type: "error", text: t("signInFirst") });
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/listings/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ listing_type: listingType, price_xaf: price }),
      });

      if (res.status === 403) {
        setMessage({ type: "error", text: t("mfaRequired") });
        setNeedsMfa(true);
      } else if (!res.ok) {
        setMessage({ type: "error", text: t("somethingWentWrong") });
      } else {
        setMessage({ type: "success", text: t("success") });
      }
    } catch {
      setMessage({ type: "error", text: t("couldNotReachServer") });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <div className="max-w-lg mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold text-[#1B2A4A] mb-2">{t("title")}</h1>
        <p className="text-gray-600 mb-6 text-sm">{t("description")}</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="text-sm font-semibold text-gray-700">{t("listingTypeLabel")}</label>
          <select value={listingType} onChange={(e) => setListingType(e.target.value)} className="border rounded px-3 py-2">
            <option value="RENT">{t("forRent")}</option>
            <option value="SALE">{t("forSale")}</option>
          </select>

          <label className="text-sm font-semibold text-gray-700">{t("priceLabel")}</label>
          <input
            type="number" required min={0} className="border rounded px-3 py-2"
            value={price} onChange={(e) => setPrice(e.target.value)}
          />

          {message && (
            <p className={message.type === "success" ? "text-green-700 text-sm" : "text-red-600 text-sm"}>
              {message.text}
            </p>
          )}
          {needsMfa && (
            <Link href="/mfa-setup" className="text-sm font-semibold text-[#1B2A4A] hover:text-[#C9A227] underline">
              {t("completeMfaSetup")} →
            </Link>
          )}

          <button type="submit" disabled={loading} className="bg-[#C9A227] text-[#1B2A4A] font-semibold py-2 rounded hover:opacity-90 disabled:opacity-50">
            {loading ? t("submitting") : t("submit")}
          </button>
        </form>
      </div>
    </main>
  );
}
