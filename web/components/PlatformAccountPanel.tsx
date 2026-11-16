"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { getPlatformSessionStatus, startPlatformSession } from "@/lib/api";

const DESTINATIONS = [
  { key: "property", href: "/list-property" },
  { key: "hotels", href: "/hotel-dashboard" },
  { key: "guestHouses", href: "/host-dashboard" },
  { key: "hostels", href: "/hostel-rooms" },
  { key: "venues", href: "/venue-dashboard" },
  { key: "store", href: "/sell" },
  { key: "technician", href: "/technician-dashboard" },
  { key: "listings", href: "/my-listings" },
  { key: "wallet", href: "/wallet" },
] as const;

/** Admin console entry to Oaziland's own offers: switches into the platform account and opens the chosen page. */
export default function PlatformAccountPanel() {
  const t = useTranslations("PlatformAccountPanel");
  const router = useRouter();
  const [status, setStatus] = useState<{ can_act: boolean; account?: { id: string; name: string } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getPlatformSessionStatus(token).then(setStatus).catch(() => setStatus({ can_act: false }));
  }, []);

  if (!status?.can_act) return null;

  async function open(href: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      await startPlatformSession(token);
      router.push(href);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm" aria-labelledby="platform-account-heading">
      <h3 id="platform-account-heading" className="text-sm font-bold text-slate-900">{t("title")}</h3>
      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">{t("intro")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {DESTINATIONS.map((d) => (
          <button
            key={d.key}
            type="button"
            disabled={busy}
            onClick={() => void open(d.href)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800 hover:border-amber-400 hover:bg-amber-50 disabled:opacity-50 cursor-pointer"
          >
            {t(`open_${d.key}`)}
          </button>
        ))}
      </div>
      {status.account && (
        <p className="mt-3 text-xs text-slate-500">
          {t("publicPage")}{" "}
          <Link href={`/user/${status.account.id}`} className="font-bold text-amber-700 hover:underline">{status.account.name}</Link>
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">{error}</p>}
    </section>
  );
}
