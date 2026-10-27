"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getMyProfile, listMyHotels, getHotelFinancialDashboard, setHotelName, type Hotel, type HotelFinancialDashboard } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Panel from "@/components/ui/Panel";
import StatCard from "@/components/ui/StatCard";
import ShareAndQrModal from "@/components/ShareAndQrModal";
import { IconQrCode, IconShare, IconArrowUpRight, IconFileText, IconCreditCard, IconSparkles } from "@/components/Icons";

/**
 * The real Hotel Owner financial dashboard — revenue/bookings trends,
 * outstanding balances, escrow status, and top room types by revenue,
 * from get_hotel_financial_dashboard() (already built, tested, and
 * now finally reachable). A hotel owner may own more than one hotel,
 * so this page lists their own hotels first and shows the financial
 * dashboard for whichever one is selected.
 */
export default function HotelDashboardPage() {
  const t = useTranslations("HotelDashboardPage");
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");
  const [userId, setUserId] = useState<string>("");
  const [myHotels, setMyHotels] = useState<Hotel[]>([]);
  const [selectedHotelId, setSelectedHotelId] = useState("");
  const [hotelNameDraft, setHotelNameDraft] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMessage, setNameMessage] = useState("");
  const [dashboard, setDashboard] = useState<HotelFinancialDashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  const loadDashboard = useCallback(async (hotelId: string) => {
    const token = localStorage.getItem("access_token");
    if (!token || !hotelId) return;
    setDashboardLoading(true);
    try {
      const data = await getHotelFinancialDashboard(hotelId, token);
      setDashboard(data);
    } catch {
      setDashboard(null);
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function init() {
      const token = localStorage.getItem("access_token");
      if (!token) {
        if (active) setStatus("signedOut");
        return;
      }
      try {
        const [profile, hotelsData] = await Promise.all([getMyProfile(token), listMyHotels(token)]);
        if (!active) return;
        setUserId(profile.id);
        const owned = hotelsData.results.filter((h) => h.owner === profile.id);
        setMyHotels(owned);
        if (owned.length > 0) {
          setSelectedHotelId(owned[0].id);
          setHotelNameDraft(owned[0].name || "");
          await loadDashboard(owned[0].id);
        }
        setStatus("ready");
      } catch {
        if (active) setStatus("ready");
      }
    }
    init();
    return () => {
      active = false;
    };
  }, [loadDashboard]);

  function handleSelectHotel(hotelId: string) {
    setSelectedHotelId(hotelId);
    const found = myHotels.find((h) => h.id === hotelId);
    setHotelNameDraft(found?.name || "");
    setNameMessage("");
    loadDashboard(hotelId);
  }

  async function handleSaveHotelName(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || !selectedHotelId || !hotelNameDraft.trim()) return;
    setNameSaving(true);
    setNameMessage("");
    try {
      const updated = await setHotelName(selectedHotelId, hotelNameDraft.trim(), token);
      setMyHotels((prev) => prev.map((h) => (h.id === updated.id ? { ...h, name: updated.name } : h)));
      setHotelNameDraft(updated.name || "");
      setNameMessage(t("hotelNameSaved"));
    } catch (err) {
      setNameMessage(err instanceof Error ? err.message : "");
    } finally {
      setNameSaving(false);
    }
  }

  if (status === "signedOut") {
    return (
      <DashboardLayout currentRole="landlord" activeHref="/hotel-dashboard" title={t("title")} subtitle={t("subtitle")}>
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
          <Button href="/login">{t("signInRequired")}</Button>
        </div>
      </DashboardLayout>
    );
  }

  if (status === "loading") {
    return (
      <DashboardLayout currentRole="landlord" activeHref="/hotel-dashboard" title={t("title")} subtitle={t("subtitle")}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 rounded-3xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      </DashboardLayout>
    );
  }

  if (myHotels.length === 0) {
    return (
      <DashboardLayout currentRole="landlord" activeHref="/hotel-dashboard" title={t("title")} subtitle={t("subtitle")}>
        <Panel>
          <EmptyState title={t("noHotels")} action={<Button href="/hotels">{t("listAHotel")}</Button>} />
        </Panel>
      </DashboardLayout>
    );
  }

  const shareUrl = typeof window !== "undefined" && userId ? `${window.location.origin}/user/${userId}` : "";

  return (
    <DashboardLayout
      currentRole="landlord"
      activeHref="/hotel-dashboard"
      title={t("title")}
      subtitle={t("subtitle")}
      action={
        userId ? (
          <div className="flex items-center gap-2">
            <Link
              href={`/user/${userId}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors shadow-2xs"
            >
              <span>Public Index Page</span>
              <IconArrowUpRight size={14} />
            </Link>
            <button
              type="button"
              onClick={() => setShowShareModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-900 text-amber-300 hover:bg-slate-800 transition-all shadow-xs cursor-pointer"
            >
              <IconQrCode size={15} />
              <IconShare size={14} />
              <span>Share & QR</span>
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="mb-6 flex flex-wrap items-end gap-4">
        {myHotels.length > 1 && (
          <div className="w-full max-w-xs">
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">{t("selectHotel")}</label>
            <select
              value={selectedHotelId}
              onChange={(e) => handleSelectHotel(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-400/15"
            >
              {myHotels.map((h) => (
                <option key={h.id} value={h.id}>{h.name ? `${h.name} (${h.quarter_name})` : h.quarter_name}</option>
              ))}
            </select>
          </div>
        )}
        <form onSubmit={handleSaveHotelName} className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">{t("hotelNameLabel")}</label>
            <input
              value={hotelNameDraft}
              onChange={(e) => setHotelNameDraft(e.target.value)}
              placeholder={t("hotelNamePlaceholder")}
              maxLength={200}
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-amber-400 focus:outline-none"
            />
          </div>
          <Button type="submit" disabled={nameSaving || !hotelNameDraft.trim()}>
            {nameSaving ? t("savingHotelName") : t("saveHotelName")}
          </Button>
          {nameMessage && <span className="text-xs font-semibold text-emerald-700">{nameMessage}</span>}
        </form>
      </div>

      {dashboardLoading || !dashboard ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 rounded-3xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard icon={IconFileText} label={t("totalBookings")} value={dashboard.total_bookings} />
            <StatCard
              icon={IconCreditCard}
              tone="amber"
              label={t("outstandingBalance")}
              value={Number(dashboard.outstanding_balance_xaf).toLocaleString()}
              unit="XAF"
            />
            <StatCard
              icon={IconSparkles}
              tone={dashboard.revenue_trend_xaf.percent_change === null ? "default" : dashboard.revenue_trend_xaf.percent_change >= 0 ? "emerald" : "rose"}
              label={t("revenueTrend")}
              value={
                dashboard.revenue_trend_xaf.percent_change === null
                  ? "—"
                  : `${dashboard.revenue_trend_xaf.percent_change > 0 ? "+" : ""}${dashboard.revenue_trend_xaf.percent_change}%`
              }
              hint={dashboard.revenue_trend_xaf.percent_change === null ? t("noHistoryYet") : t("vsLastPeriod")}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
            <Panel title={t("topRoomTypes")}>
              {dashboard.top_room_types_by_revenue.length === 0 ? (
                <p className="text-sm text-slate-400">{t("noHistoryYet")}</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {dashboard.top_room_types_by_revenue.map((row) => (
                    <li key={row.group} className="flex items-center justify-between gap-3 py-3 text-sm">
                      <span className="font-semibold text-slate-700">{row.group}</span>
                      <span className="font-black text-slate-900">{Number(row.total).toLocaleString()} XAF</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title={t("escrowStatus")}>
              {Object.keys(dashboard.escrow_status_breakdown).length === 0 ? (
                <p className="text-sm text-slate-400">{t("noHistoryYet")}</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {Object.entries(dashboard.escrow_status_breakdown).map(([escrowStatus, count]) => (
                    <li key={escrowStatus} className="flex items-center justify-between gap-3 py-3 text-sm">
                      <span className="font-semibold text-slate-700">{escrowStatus.replace(/_/g, " ")}</span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-black text-slate-700">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}

      {userId && (
        <ShareAndQrModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          url={shareUrl}
          title="My Hotel Portfolio"
          subtitle="Share your verified hotels page and QR code with guests and travelers."
        />
      )}
    </DashboardLayout>
  );
}
