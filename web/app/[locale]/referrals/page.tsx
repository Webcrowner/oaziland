"use client";
import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getMyReferralCode } from "@/lib/api";

/**
 * A real referral code AND link page — fetches the user's actual,
 * persistent code from the backend (generated lazily on first
 * request), builds a real, locale-aware, clickable link out of it
 * (https://.../en/register?ref=CODE), and wires it into an actual
 * WhatsApp share message. WHY the link matters beyond the bare code:
 * a code someone has to manually type in is real friction — a link
 * that auto-applies the code the moment someone lands on the register
 * page (see register/page.tsx's own ?ref= handling) is what actually
 * gets used.
 */
export default function ReferralsPage() {
  const t = useTranslations("ReferralPage");
  const locale = useLocale();
  const [code, setCode] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(true);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    const token = localStorage.getItem("access_token");
    if (!token) {
      setLoggedIn(false);
      return;
    }
    getMyReferralCode(token)
      .then((data) => setCode(data.referral_code))
      .catch(() => {});
  }, []);

  const referralLink = code && origin ? `${origin}/${locale}/register?ref=${code}` : "";

  function handleCopyCode() {
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  }

  function handleCopyLink() {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
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

  const shareMessage = code ? `${t("shareText", { code })}${referralLink}` : "";
  const whatsappLink = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`;

  return (
    <main className="max-w-md mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-[#1B2A4A] mb-2">{t("title")}</h1>
      <p className="text-gray-600 mb-8">{t("subtitle")}</p>

      {code ? (
        <>
          <div className="border-2 border-dashed border-[#C9A227] rounded-lg py-6 px-4 mb-4">
            <p className="text-xs text-gray-500 mb-1">{t("yourCode")}</p>
            <p className="text-3xl font-bold text-[#1B2A4A] tracking-widest mb-3">{code}</p>
            {referralLink && (
              <>
                <p className="text-xs text-gray-500 mb-1">{t("yourLink")}</p>
                <p className="text-sm text-[#1B2A4A] break-all">{referralLink}</p>
              </>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <button onClick={handleCopyCode} className="border border-[#1B2A4A] text-[#1B2A4A] font-semibold py-2 rounded hover:bg-gray-50">
              {copiedCode ? t("copied") : t("copyCode")}
            </button>
            <button onClick={handleCopyLink} disabled={!referralLink} className="border border-[#1B2A4A] text-[#1B2A4A] font-semibold py-2 rounded hover:bg-gray-50 disabled:opacity-50">
              {copiedLink ? t("copied") : t("copyLink")}
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
