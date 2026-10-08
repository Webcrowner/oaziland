"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import DashboardLayout from "@/components/DashboardLayout";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import StatCard from "@/components/ui/StatCard";
import ShareAndQrModal from "@/components/ShareAndQrModal";
import { getMyAgencyDashboard, addAgentToRoster, removeAgentFromRoster, getMyProfile, type AgencyDashboard } from "@/lib/api";
import { IconShare, IconQrCode, IconArrowUpRight, IconUsers, IconBuilding, IconMessageCircle, IconCreditCard } from "@/components/Icons";

/**
 * The team-wide agency dashboard — previously MISSING entirely: agency
 * owner data was only ever bolted onto the founder's own personal agent
 * dashboard, so any other agent on an agency's roster had no way to see
 * team listings, team leads, or team commission at all. Reuses the real
 * backend aggregation (agency.services.get_agency_private_dashboard),
 * reachable by the owner or any agent on the roster.
 */
export default function AgencyDashboardPage() {
  const t = useTranslations("AgencyDashboardPage");
  const [dashboard, setDashboard] = useState<AgencyDashboard | null>(null);
  const [status, setStatus] = useState<"loading" | "signedOut" | "notInAgency" | "ready">("loading");
  const [newAgentId, setNewAgentId] = useState("");
  const [rosterStatus, setRosterStatus] = useState<"idle" | "busy" | "error">("idle");
  const [rosterError, setRosterError] = useState("");
  const [userId, setUserId] = useState<string>("");
  const [showShareModal, setShowShareModal] = useState(false);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    Promise.all([getMyAgencyDashboard(token), getMyProfile(token)])
      .then(([data, profile]) => {
        setDashboard(data);
        setUserId(profile.id);
        setStatus("ready");
      })
      .catch(() => setStatus("notInAgency"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAddAgent(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || !newAgentId) return;
    setRosterStatus("busy");
    setRosterError("");
    try {
      await addAgentToRoster(newAgentId, token);
      setNewAgentId("");
      load();
    } catch (err) {
      setRosterError(err instanceof Error ? err.message : t("addAgentFailed"));
      setRosterStatus("error");
      return;
    }
    setRosterStatus("idle");
  }

  async function handleRemoveAgent(agentUserId: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await removeAgentFromRoster(agentUserId, token);
    load();
  }

  if (status === "signedOut") {
    return (
      <DashboardLayout currentRole="agent" activeHref="/agency-dashboard" title={t("title")}>
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
          <Button href="/login">{t("signInRequired")}</Button>
        </div>
      </DashboardLayout>
    );
  }

  if (status === "notInAgency") {
    return (
      <DashboardLayout currentRole="agent" activeHref="/agency-dashboard" title={t("title")}>
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-slate-600 font-semibold text-sm">{t("notInAgency")}</p>
        </div>
      </DashboardLayout>
    );
  }

  if (status === "loading" || !dashboard) {
    return (
      <DashboardLayout currentRole="agent" activeHref="/agency-dashboard" title={t("title")}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 rounded-3xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      </DashboardLayout>
    );
  }

  const trend = dashboard.commission_trend_xaf;
  const shareUrl = typeof window !== "undefined" && userId ? `${window.location.origin}/user/${userId}` : "";

  return (
    <DashboardLayout
      currentRole="agent"
      activeHref="/agency-dashboard"
      title={dashboard.agency_profile.agency_name}
      subtitle={`${t("registrationNumber")}: ${dashboard.agency_profile.registration_number} · ${t("averageRating")}: ${dashboard.agency_profile.average_rating ?? "—"} (${dashboard.agency_profile.rating_count})`}
      action={
        userId ? (
          <div className="flex items-center gap-2">
            <Link
              href={`/user/${userId}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors shadow-2xs"
            >
              <span>{t("publicIndex")}</span>
              <IconArrowUpRight size={14} />
            </Link>
            <button
              type="button"
              onClick={() => setShowShareModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-900 text-amber-300 hover:bg-slate-800 transition-all shadow-xs cursor-pointer"
            >
              <IconQrCode size={15} />
              <IconShare size={14} />
              <span>{t("shareAndQr")}</span>
            </button>
          </div>
        ) : undefined
      }
    >

      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard icon={IconUsers} label={t("teamSize")} value={dashboard.team_size} />
          <StatCard icon={IconBuilding} tone="indigo" label={t("activeTeamListings")} value={dashboard.active_team_listings} />
          <StatCard icon={IconMessageCircle} tone="amber" label={t("openTeamLeads")} value={dashboard.open_team_leads} />
        </div>

        <StatCard
          icon={IconCreditCard}
          tone={trend.percent_change !== null && trend.percent_change < 0 ? "rose" : "emerald"}
          label={t("commissionTrend")}
          value={Number(trend.current_period_value).toLocaleString()}
          unit="XAF"
          hint={
            <>
              {trend.percent_change === null ? t("newNoHistory") : `${trend.percent_change > 0 ? "+" : ""}${trend.percent_change}% ${t("vsLastPeriod")}`}
              {" · "}
              {t("totalCommission")}: <span className="font-bold text-slate-600">{Number(dashboard.agency_aggregated_commission_xaf || 0).toLocaleString()} XAF</span>
            </>
          }
        />

        <Panel title={t("teamSection")}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            {dashboard.team.map((member) => (
              <div key={member.user_id} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-sm font-black text-amber-300">
                  {(member.full_name.charAt(0) || "?").toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-900">{member.full_name}</p>
                  <p className="text-xs text-slate-500">
                    {member.active_listing_count} {t("agentListings")} · {member.open_enquiries} {t("agentOpenLeads")}
                  </p>
                </div>
                <button
                  onClick={() => handleRemoveAgent(member.user_id)}
                  className="shrink-0 rounded-xl border border-red-200 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
                >
                  {t("remove")}
                </button>
              </div>
            ))}
          </div>

          <form onSubmit={handleAddAgent} className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center rounded-2xl border border-dashed border-slate-300 p-4">
            <input
              placeholder={t("agentUserIdPlaceholder")} value={newAgentId} onChange={(e) => setNewAgentId(e.target.value)}
              className="flex-1 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:bg-white focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-400/15"
            />
            <Button disabled={rosterStatus === "busy"}>{rosterStatus === "busy" ? t("adding") : t("addAgentToRoster")}</Button>
          </form>
          {rosterError && <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{rosterError}</p>}
        </Panel>
      </div>

      {userId && (
        <ShareAndQrModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          url={shareUrl}
          title={t("shareTitle")}
          subtitle={t("shareSubtitle")}
        />
      )}
    </DashboardLayout>
  );
}
