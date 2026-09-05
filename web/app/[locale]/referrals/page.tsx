"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getMyReferralCode } from "@/lib/api";

/**
 * A real referral code page — fetches the user's actual, persistent
 * code from the backend (generated lazily on first request), with a
 * real WhatsApp share link, not a placeholder.
 */
export default function ReferralsPage() {
  const t = useTranslations("ReferralPage");
  const [code, setCode] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setLoggedIn(false);
      return;
    }
    getMyReferralCode(token)
      .then((data) => setCode(data.referral_code))
      .catch(() => {});
  }, []);

  function handleCopy() {
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!loggedIn) {
    return (
      <main className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="text-gray-600 mb-4">{t("signInToSeeCode")}</p>
        <Link href="/login" className="inline-block bg-[#1B2A4A] text-white font-semibold px-6 py-3 rounded hover:opacity-90">
          {t("signInToSeeCode")}
        </Link>
      </main>
    );
  }

  const shareMessage = code ? t("shareText", { code }) : "";
  const whatsappLink = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`;

  return (
    <main className="max-w-md mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-[#1B2A4A] mb-2">{t("title")}</h1>
      <p className="text-gray-600 mb-8">{t("subtitle")}</p>

      {code ? (
        <>
          <div className="border-2 border-dashed border-[#C9A227] rounded-lg py-6 px-4 mb-4">
            <p className="text-xs text-gray-500 mb-1">{t("yourCode")}</p>
            <p className="text-3xl font-bold text-[#1B2A4A] tracking-widest">{code}</p>
          </div>

          <div className="flex flex-col gap-3">
            <button onClick={handleCopy} className="border border-[#1B2A4A] text-[#1B2A4A] font-semibold py-2 rounded hover:bg-gray-50">
              {copied ? t("copied") : t("copy")}
            </button>
            <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="bg-[#C9A227] text-[#1B2A4A] font-semibold py-3 rounded hover:opacity-90">
              {t("shareOnWhatsApp")}
            </a>
          </div>
        </>
      ) : (
        <p className="text-gray-400">...</p>
      )}
    </main>
  );
}
