"use client";
import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { getMyReferralCode, getMyReferrals, type MyReferralsSummary } from "@/lib/api";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import Button from "@/components/ui/Button";

/**
 * A real referral code AND link page — fetches the user's actual,
 * persistent code from the backend (generated lazily on first
 * request), builds a real, locale-aware, clickable link out of it
 * (https://.../en/register?ref=CODE), and wires it into an actual
 * WhatsApp share message. Shows the live tracked list of referred users,
 * their qualification status (pending vs KYC-verified), and earned rewards.
 */
export default function ReferralsPage() {
  const t = useTranslations("ReferralPage");
  const locale = useLocale();
  const [code, setCode] = useState<string | null>(null);
  const [referralsData, setReferralsData] = useState<MyReferralsSummary | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loggedIn, setLoggedIn] = useState(true);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    void Promise.resolve().then(() => {
      setOrigin(window.location.origin);
      if (!token) {
        setLoggedIn(false);
      }
    });
    if (!token) return;
    getMyReferralCode(token)
      .then((data) => setCode(data.referral_code))
      .catch(() => {});

    getMyReferrals(token)
      .then(setReferralsData)
      .catch(() => {})
      .finally(() => setLoadingList(false));
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
      <AccountSidebarLayout activeHref="/referrals">
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-gray-600 mb-4">{t("signInToSeeCode")}</p>
          <Button href="/login">{t("signInToSeeCode")}</Button>
        </div>
      </AccountSidebarLayout>
    );
  }

  const shareMessage = code ? `${t("shareText", { code })}${referralLink}` : "";
  const whatsappLink = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`;

  return (
    <AccountSidebarLayout activeHref="/referrals">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="font-[family-name:var(--font-display)] text-2xl text-[var(--navy)] mb-2">{t("title")}</h1>
          <p className="text-gray-600">{t("subtitle")}</p>
        </div>

        {code ? (
          <>
            <div className="border-2 border-dashed border-[var(--gold)] rounded-2xl py-6 px-4 mb-6 bg-amber-50/20 text-center max-w-md mx-auto">
              <p className="text-xs text-gray-500 mb-1">{t("yourCode")}</p>
              <p className="text-3xl font-bold text-[var(--navy)] tracking-widest mb-3">{code}</p>
              {referralLink && (
                <>
                  <p className="text-xs text-gray-500 mb-1">{t("yourLink")}</p>
                  <p className="text-xs text-[var(--navy)] break-all font-mono bg-white p-2 rounded-lg border border-slate-200">{referralLink}</p>
                </>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center mb-10 max-w-md mx-auto">
              <button
                onClick={handleCopyCode}
                className="flex-1 border border-[var(--navy)] text-[var(--navy)] font-semibold py-2 px-3 rounded-xl hover:bg-gray-50 text-sm"
              >
                {copiedCode ? t("copied") : t("copyCode")}
              </button>
              <button
                onClick={handleCopyLink}
                disabled={!referralLink}
                className="flex-1 border border-[var(--navy)] text-[var(--navy)] font-semibold py-2 px-3 rounded-xl hover:bg-gray-50 disabled:opacity-50 text-sm"
              >
                {copiedLink ? t("copied") : t("copyLink")}
              </button>
              <a
                href={whatsappLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 bg-[var(--gold)] text-[var(--navy)] font-semibold py-2 px-3 rounded-xl hover:opacity-90 text-center text-sm flex items-center justify-center gap-1.5"
              >
                <span>💬</span>
                <span>{t("shareOnWhatsApp")}</span>
              </a>
            </div>

            {/* Referrals Tracking Metrics & List */}
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-6">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h2 className="text-base font-bold text-slate-900">{t("referralListTitle")}</h2>
                {referralsData && (
                  <span className="text-xs text-slate-500 font-medium">
                    {t("totalReferred")}: <strong>{referralsData.total_count}</strong>
                  </span>
                )}
              </div>

              {referralsData && (
                <div className="grid grid-cols-3 gap-3 mb-6 text-center">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <p className="text-[11px] text-slate-500 uppercase font-semibold">{t("totalReferred")}</p>
                    <p className="text-lg font-bold text-slate-900 mt-0.5">{referralsData.total_count}</p>
                  </div>
                  <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                    <p className="text-[11px] text-emerald-700 uppercase font-semibold">{t("qualified")}</p>
                    <p className="text-lg font-bold text-emerald-800 mt-0.5">{referralsData.qualified_count}</p>
                  </div>
                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-100">
                    <p className="text-[11px] text-amber-700 uppercase font-semibold">{t("rewardEarned")}</p>
                    <p className="text-lg font-bold text-amber-900 mt-0.5">
                      {Number(referralsData.total_reward_xaf).toLocaleString()} XAF
                    </p>
                  </div>
                </div>
              )}

              {loadingList ? (
                <p className="text-xs text-slate-400 py-6 text-center">Loading referral activity...</p>
              ) : !referralsData || referralsData.results.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  <span className="text-2xl block mb-2">🎁</span>
                  {t("noReferralsYet")}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-400 uppercase text-[10px] tracking-wider">
                        <th className="py-2.5 px-3 font-semibold">{t("userCol")}</th>
                        <th className="py-2.5 px-3 font-semibold">{t("statusCol")}</th>
                        <th className="py-2.5 px-3 font-semibold">{t("rewardCol")}</th>
                        <th className="py-2.5 px-3 font-semibold">{t("dateCol")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {referralsData.results.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/50">
                          <td className="py-2.5 px-3 font-semibold text-slate-900">
                            {item.referred_user_name || `@${item.referred_username}`}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                item.status === "REWARDED"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : item.status === "QUALIFIED"
                                  ? "bg-blue-100 text-blue-800"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {t(`status_${item.status}`)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-bold text-slate-800">
                            {Number(item.reward_earned_xaf) > 0
                              ? `+${Number(item.reward_earned_xaf).toLocaleString()} XAF`
                              : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-slate-400">
                            {new Date(item.created_at).toLocaleDateString(
                              locale === "fr" ? "fr-FR" : "en-US",
                              { month: "short", day: "numeric", year: "numeric" }
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="text-gray-400 text-center">...</p>
        )}
      </div>
    </AccountSidebarLayout>
  );
}
