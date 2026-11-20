"use client";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import {
  deleteListing, getMyProfile, listMyListings, renewListing, setListingStatus, type Listing,
} from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Panel from "@/components/ui/Panel";
import { IconMapPin, IconClock, IconAlertCircle, IconBuilding } from "@/components/Icons";

const STATUS_TABS = ["", "PUBLISHED", "PENDING_REVIEW", "UNDER_OFFER", "CLOSED", "REJECTED", "EXPIRED"] as const;

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  PENDING_REVIEW: "bg-amber-100 text-amber-800",
  PUBLISHED: "bg-emerald-100 text-emerald-800",
  UNDER_OFFER: "bg-sky-100 text-sky-800",
  CLOSED: "bg-slate-200 text-slate-700",
  REJECTED: "bg-rose-100 text-rose-800",
  EXPIRED: "bg-orange-100 text-orange-800",
};

const actionBtn =
  "px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer";

export default function MyListingsPage() {
  const t = useTranslations("MyListingsPage");
  const tSignIn = useTranslations("SignInPrompt");
  const [role, setRole] = useState<"landlord" | "agent">("landlord");
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState("");
  const [listings, setListings] = useState<Listing[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState<"loading" | "signedOut" | "ready" | "error">("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async (accessToken: string, status: string, pageNumber: number, append: boolean) => {
    try {
      const data = await listMyListings(accessToken, status || undefined, pageNumber);
      setListings((prev) => (append ? [...prev, ...data.results] : data.results));
      setHasMore(Boolean(data.next));
      setPage(pageNumber);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("access_token");
    if (!stored) {
      void Promise.resolve().then(() => setState("signedOut"));
      return;
    }
    void Promise.resolve().then(() => setToken(stored));
    getMyProfile(stored).then((p) => setRole(p.is_agent ? "agent" : "landlord")).catch(() => {});
  }, []);

  useEffect(() => {
    if (token) {
      void Promise.resolve().then(() => load(token, tab, 1, false));
    }
  }, [token, tab, load]);

  async function run(listing: Listing, action: () => Promise<unknown>, success: string) {
    if (!token) return;
    setBusyId(listing.id);
    setMessage("");
    try {
      await action();
      setMessage(success);
      await load(token, tab, 1, false);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("somethingWrong"));
    } finally {
      setBusyId(null);
    }
  }

  const layoutProps = {
    currentRole: role,
    activeHref: "/my-listings",
    title: t("title"),
    subtitle: t("subtitle"),
    action: <Button href="/list-property">{t("addProperty")}</Button>,
  } as const;

  if (state === "signedOut") {
    return (
      <DashboardLayout {...layoutProps}>
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-slate-600 mb-4 font-semibold text-sm">{tSignIn("myListings")}</p>
          <Button href="/login">{tSignIn("button")}</Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout {...layoutProps}>
      <div className="flex flex-wrap gap-2 mb-5">
        {STATUS_TABS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`px-4 py-2 rounded-full text-sm font-bold border transition-colors cursor-pointer ${
              tab === value ? "bg-slate-900 text-white border-slate-900 shadow-sm" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {value ? t(`status_${value}`) : t("tabAll")}
          </button>
        ))}
      </div>

      {message && <p className="mb-4 text-sm text-slate-700 bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm" role="status">{message}</p>}

      {state === "loading" ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 rounded-3xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : state === "error" ? (
        <p className="flex items-center justify-center gap-2 rounded-3xl border border-rose-100 bg-rose-50 py-12 text-sm font-semibold text-rose-700">
          <IconAlertCircle size={18} /> {t("loadFailed")}
        </p>
      ) : listings.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<IconBuilding size={28} />}
            title={tab ? t("emptyFiltered") : t("emptyNone")}
            action={<Button href="/list-property">{t("listProperty")}</Button>}
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-3">
          {listings.map((l) => {
            const photo = l.photos?.find((p) => p.media_type === "PHOTO");
            const busy = busyId === l.id;
            const closeLabel = l.listing_type === "SALE" ? t("markSold") : t("markRented");
            const expires = l.expires_at ? new Date(l.expires_at).toLocaleDateString() : null;
            return (
              <div key={l.id} className="bg-white border border-slate-200/90 rounded-3xl p-3 sm:p-4 flex flex-col sm:flex-row gap-4 shadow-sm transition-shadow hover:shadow-md">
                <div className="w-full sm:w-44 h-36 sm:h-auto sm:min-h-32 shrink-0 rounded-2xl overflow-hidden bg-slate-100">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo.url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300"><IconBuilding size={32} /></div>
                  )}
                </div>

                <div className="flex-1 min-w-0 py-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className={`text-[11px] font-extrabold uppercase tracking-wide px-2.5 py-1 rounded-full ${STATUS_STYLE[l.status] ?? STATUS_STYLE.DRAFT}`}>
                      {t.has(`status_${l.status}`) ? t(`status_${l.status}`) : l.status}
                    </span>
                    <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      {l.listing_type === "SALE" ? t("forSale") : t("forRent")} · {l.property_asset.type}
                    </span>
                  </div>
                  <p className="font-black tracking-tight text-slate-900 text-xl">{Number(l.price_xaf).toLocaleString()} <span className="text-sm font-bold text-slate-400">XAF</span></p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-600 truncate"><IconMapPin size={14} className="shrink-0 text-slate-400" />{l.property_asset.quarter_name}</p>
                  {expires && l.status === "PUBLISHED" && <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400"><IconClock size={12} />{t("expires", { date: expires })}</p>}
                  {l.status === "PENDING_REVIEW" && <p className="mt-1 text-xs font-semibold text-amber-700">{t("waitingApproval")}</p>}
                  {l.status === "REJECTED" && <p className="mt-1 text-xs font-semibold text-rose-700">{t("rejectedNote")}</p>}

                  <div className="flex flex-wrap gap-2 mt-4">
                    <Link href={`/listing/${l.id}`} className={actionBtn}>{t("view")}</Link>
                    <Link href={`/listing/${l.id}/edit`} className={actionBtn}>{t("edit")}</Link>
                    {l.status === "PUBLISHED" && (
                      <Link href={`/videos/create?listing_id=${l.id}`} className={actionBtn}>{t("postVideo")}</Link>
                    )}
                    {(l.status === "PUBLISHED" || l.status === "EXPIRED") && (
                      <button type="button" disabled={busy} className={actionBtn} onClick={() => run(l, () => renewListing(l.id, token!), t("renewed"))}>
                        {t("renew")}
                      </button>
                    )}
                    {l.status === "PUBLISHED" && (
                      <button type="button" disabled={busy} className={actionBtn} onClick={() => run(l, () => setListingStatus(l.id, "UNDER_OFFER", token!), t("markedUnderOffer"))}>
                        {t("markUnderOffer")}
                      </button>
                    )}
                    {(l.status === "PUBLISHED" || l.status === "UNDER_OFFER") && (
                      <button type="button" disabled={busy} className={actionBtn} onClick={() => run(l, () => setListingStatus(l.id, "CLOSED", token!), t("closed"))}>
                        {closeLabel}
                      </button>
                    )}
                    {(l.status === "UNDER_OFFER" || l.status === "CLOSED") && (
                      <button type="button" disabled={busy} className={actionBtn} onClick={() => run(l, () => setListingStatus(l.id, "PUBLISHED", token!), t("liveAgain"))}>
                        {l.status === "CLOSED" ? t("reopen") : t("backToPublished")}
                      </button>
                    )}
                    {l.status !== "PUBLISHED" && l.status !== "UNDER_OFFER" && (
                      <button
                        type="button"
                        disabled={busy}
                        className={`${actionBtn} !text-rose-700 !border-rose-200 hover:!bg-rose-50`}
                        onClick={() => {
                          if (window.confirm(t("deleteConfirm"))) run(l, () => deleteListing(l.id, token!), t("deleted"));
                        }}
                      >
                        {t("delete")}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {hasMore && token && (
            <button type="button" className={`${actionBtn} self-center`} onClick={() => load(token, tab, page + 1, true)}>
              {t("loadMore")}
            </button>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}
