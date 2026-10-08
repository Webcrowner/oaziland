"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { getMyProfile, renewListing } from "@/lib/api";

/** Edit and renew shortcuts shown only to the person who listed the property. */
export default function ListingOwnerActions({
  listingId, listerId, expiresAt,
}: {
  listingId: string;
  listerId: string;
  expiresAt?: string | null;
}) {
  const t = useTranslations("EditListingPage");
  const locale = useLocale();
  const router = useRouter();
  const [isLister, setIsLister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getMyProfile(token).then((p) => setIsLister(p.id === listerId)).catch(() => {});
  }, [listerId]);

  if (!isLister) return null;

  async function handleRenew() {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBusy(true);
    setMessage(null);
    try {
      await renewListing(listingId, token);
      setMessage(t("renewed"));
      router.refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const expiry = expiresAt
    ? new Date(expiresAt).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <div className="rounded-lg border border-dashed border-[var(--gold)] bg-[var(--gold)]/5 p-4 mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/listing/${listingId}/edit`}
          className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-[var(--navy)] text-white text-sm font-semibold hover:bg-slate-800 transition-colors"
        >
          {t("editListing")}
        </Link>
        <button
          type="button"
          onClick={handleRenew}
          disabled={busy}
          className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-[var(--navy)] text-[var(--navy)] text-sm font-semibold hover:bg-gray-50 transition-colors disabled:opacity-60"
        >
          {busy ? t("renewing") : t("renew")}
        </button>
      </div>
      {expiry && <p className="text-xs text-gray-500 mt-2">{t("expiresOn", { date: expiry })}</p>}
      {message && <p className="text-xs text-gray-600 mt-1">{message}</p>}
    </div>
  );
}
