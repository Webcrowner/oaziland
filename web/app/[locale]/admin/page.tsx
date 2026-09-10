"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  getAdminConsoleSummary, listAdminVerificationRequests, approveVerificationRequest, rejectVerificationRequest,
  listAdminContentReports, resolveContentReport,
  listAdminDisputeCases, respondToDispute, resolveDispute,
  listHotelsForAdmin, verifyHotel, listVenuesForAdmin, verifyVenue,
  type AdminConsoleSummary, type AdminVerificationRequest, type AdminContentReport, type AdminDisputeCase,
  type Hotel, type Venue,
} from "@/lib/api";

type Tab = "summary" | "verifications" | "reports" | "disputes" | "listings";

/**
 * The real Admin Console — every queue an admin actually works
 * through, wired to the real backend (built this session): approving/
 * rejecting verification requests, resolving content reports (with an
 * optional real strike), and responding to/resolving payment disputes.
 * IsAdminRole-gated on the backend; this page itself checks for a 403
 * and shows a plain "not an admin" state rather than a broken page.
 */
export default function AdminConsolePage() {
  const t = useTranslations("AdminConsolePage");
  const [tab, setTab] = useState<Tab>("summary");
  const [status, setStatus] = useState<"loading" | "signedOut" | "notAdmin" | "ready">("loading");
  const [summary, setSummary] = useState<AdminConsoleSummary | null>(null);
  const [verifications, setVerifications] = useState<AdminVerificationRequest[]>([]);
  const [reports, setReports] = useState<AdminContentReport[]>([]);
  const [disputes, setDisputes] = useState<AdminDisputeCase[]>([]);
  const [pendingHotels, setPendingHotels] = useState<Hotel[]>([]);
  const [pendingVenues, setPendingVenues] = useState<Venue[]>([]);

  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;

  const loadAll = useCallback(() => {
    if (!token) {
      setStatus("signedOut");
      return;
    }
    Promise.all([
      getAdminConsoleSummary(token),
      listAdminVerificationRequests(token),
      listAdminContentReports(token),
      listAdminDisputeCases(token),
      listHotelsForAdmin(token),
      listVenuesForAdmin(token),
    ])
      .then(([summaryData, verificationsData, reportsData, disputesData, hotelsData, venuesData]) => {
        setSummary(summaryData);
        setVerifications(verificationsData.results);
        setReports(reportsData.results);
        setDisputes(disputesData.results);
        setPendingHotels(hotelsData.results.filter((h) => !h.verified));
        setPendingVenues(venuesData.results.filter((v) => !v.verified));
        setStatus("ready");
      })
      .catch(() => setStatus("notAdmin"));
  }, [token]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function handleApprove(id: string) {
    if (!token) return;
    const res = await approveVerificationRequest(id, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  async function handleReject(id: string) {
    if (!token) return;
    const reason = prompt(t("rejectReasonPlaceholder")) || "";
    const res = await rejectVerificationRequest(id, reason, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  async function handleResolveReport(id: string) {
    if (!token) return;
    const actionTaken = prompt(t("actionTakenPlaceholder"));
    if (!actionTaken) return;
    const issueStrike = confirm(t("issueStrike"));
    const res = await resolveContentReport(id, actionTaken, issueStrike, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  async function handleRespondDispute(id: string) {
    if (!token) return;
    const res = await respondToDispute(id, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  async function handleResolveDispute(id: string, outcome: "RELEASE" | "REFUND") {
    if (!token) return;
    const notes = prompt(t("resolutionNotesPlaceholder")) || "";
    const res = await resolveDispute(id, outcome, notes, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  async function handleVerifyHotel(id: string) {
    if (!token) return;
    const res = await verifyHotel(id, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  async function handleVerifyVenue(id: string) {
    if (!token) return;
    const res = await verifyVenue(id, token);
    if (!res.ok) {
      alert(t("actionFailed"));
      return;
    }
    loadAll();
  }

  if (status === "signedOut") {
    return (
      <main className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
        <Link href="/login" className="inline-block bg-[var(--navy)] text-white font-semibold px-6 py-3 rounded hover:opacity-90">
          {t("signInRequired")}
        </Link>
      </main>
    );
  }

  if (status === "notAdmin") {
    return <main className="max-w-md mx-auto px-4 py-16 text-center text-gray-600">{t("notAdmin")}</main>;
  }

  if (status === "loading" || !summary) {
    return <main className="max-w-5xl mx-auto px-4 py-16 text-center text-gray-400">...</main>;
  }

  const tabs: { key: Tab; labelKey: string }[] = [
    { key: "summary", labelKey: "tabSummary" },
    { key: "verifications", labelKey: "tabVerifications" },
    { key: "reports", labelKey: "tabReports" },
    { key: "disputes", labelKey: "tabDisputes" },
    { key: "listings", labelKey: "tabListings" },
  ];

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-[var(--navy)] mb-6">{t("title")}</h1>

      <div className="flex flex-wrap gap-2 mb-8 border-b pb-4">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.key}
            onClick={() => setTab(tabItem.key)}
            className={`px-4 py-2 rounded text-sm font-semibold transition-colors ${tab === tabItem.key ? "bg-[var(--navy)] text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
          >
            {t(tabItem.labelKey)}
            {tabItem.key === "verifications" && verifications.length > 0 && ` (${verifications.length})`}
            {tabItem.key === "reports" && reports.length > 0 && ` (${reports.length})`}
            {tabItem.key === "disputes" && disputes.length > 0 && ` (${disputes.length})`}
            {tabItem.key === "listings" && (pendingHotels.length + pendingVenues.length) > 0 && ` (${pendingHotels.length + pendingVenues.length})`}
          </button>
        ))}
      </div>

      {tab === "summary" && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="border rounded-lg p-5 bg-white">
            <p className="text-xs text-gray-500 mb-1">{t("pendingVerifications")}</p>
            <p className="text-2xl font-bold text-[var(--navy)]">{summary.pending_verification_requests}</p>
          </div>
          <div className="border rounded-lg p-5 bg-white">
            <p className="text-xs text-gray-500 mb-1">{t("openReports")}</p>
            <p className="text-2xl font-bold text-[var(--navy)]">{summary.open_content_reports}</p>
          </div>
          <div className="border rounded-lg p-5 bg-white">
            <p className="text-xs text-gray-500 mb-1">{t("openDisputes")}</p>
            <p className="text-2xl font-bold text-[var(--navy)]">{summary.open_dispute_cases}</p>
          </div>
        </div>
      )}

      {tab === "verifications" && (
        <div className="flex flex-col gap-3">
          {verifications.length === 0 ? (
            <p className="text-gray-500">{t("noItems")}</p>
          ) : (
            verifications.map((v) => (
              <div key={v.id} className="border rounded-lg p-4 bg-white flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="font-semibold text-[var(--navy)] text-sm">{v.requester_name} — {v.request_type.replaceAll("_", " ")}</p>
                  {v.supporting_document_url && (
                    <a href={v.supporting_document_url} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--navy)] underline">
                      {v.supporting_document_url}
                    </a>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleApprove(v.id)} className="bg-green-600 text-white text-xs font-semibold px-3 py-2 rounded hover:opacity-90">{t("approve")}</button>
                  <button onClick={() => handleReject(v.id)} className="bg-red-600 text-white text-xs font-semibold px-3 py-2 rounded hover:opacity-90">{t("reject")}</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "reports" && (
        <div className="flex flex-col gap-3">
          {reports.length === 0 ? (
            <p className="text-gray-500">{t("noItems")}</p>
          ) : (
            reports.map((r) => (
              <div key={r.id} className="border rounded-lg p-4 bg-white flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="font-semibold text-[var(--navy)] text-sm">{r.reason.replaceAll("_", " ")}</p>
                  <p className="text-xs text-gray-500">{t("tabReports")}: {r.reported_by_name}</p>
                  {r.notes && <p className="text-xs text-gray-600 mt-1">{r.notes}</p>}
                </div>
                <button onClick={() => handleResolveReport(r.id)} className="bg-[var(--navy)] text-white text-xs font-semibold px-3 py-2 rounded hover:opacity-90">{t("resolve")}</button>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "disputes" && (
        <div className="flex flex-col gap-3">
          {disputes.length === 0 ? (
            <p className="text-gray-500">{t("noItems")}</p>
          ) : (
            disputes.map((d) => (
              <div key={d.id} className="border rounded-lg p-4 bg-white">
                <p className="font-semibold text-[var(--navy)] text-sm mb-1">{d.raised_by_name} — {d.status}</p>
                <p className="text-xs text-gray-600 mb-3">{d.reason}</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => handleRespondDispute(d.id)} className="border border-[var(--navy)] text-[var(--navy)] text-xs font-semibold px-3 py-2 rounded hover:bg-gray-50">{t("respond")}</button>
                  <button onClick={() => handleResolveDispute(d.id, "RELEASE")} className="bg-green-600 text-white text-xs font-semibold px-3 py-2 rounded hover:opacity-90">{t("resolveRelease")}</button>
                  <button onClick={() => handleResolveDispute(d.id, "REFUND")} className="bg-red-600 text-white text-xs font-semibold px-3 py-2 rounded hover:opacity-90">{t("resolveRefund")}</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "listings" && (
        <div className="flex flex-col gap-6">
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">{t("pendingHotels")}</h2>
            {pendingHotels.length === 0 ? (
              <p className="text-gray-500">{t("noItems")}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {pendingHotels.map((hotel) => (
                  <div key={hotel.id} className="border rounded-lg p-4 bg-white flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <p className="font-semibold text-[var(--navy)] text-sm">{hotel.quarter_name}</p>
                      <p className="text-xs text-gray-500">
                        {hotel.room_types.length === 1 ? t("roomsAvailable", { count: hotel.room_types.length }) : t("roomsAvailableOther", { count: hotel.room_types.length })}
                      </p>
                    </div>
                    <button onClick={() => handleVerifyHotel(hotel.id)} className="bg-green-600 text-white text-xs font-semibold px-3 py-2 rounded hover:opacity-90">{t("verify")}</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">{t("pendingVenues")}</h2>
            {pendingVenues.length === 0 ? (
              <p className="text-gray-500">{t("noItems")}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {pendingVenues.map((venue) => (
                  <div key={venue.id} className="border rounded-lg p-4 bg-white flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <p className="font-semibold text-[var(--navy)] text-sm">{venue.quarter_name}</p>
                      <p className="text-xs text-gray-500">
                        {venue.spaces.length === 1 ? t("spacesAvailable", { count: venue.spaces.length }) : t("spacesAvailableOther", { count: venue.spaces.length })}
                      </p>
                    </div>
                    <button onClick={() => handleVerifyVenue(venue.id)} className="bg-green-600 text-white text-xs font-semibold px-3 py-2 rounded hover:opacity-90">{t("verify")}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
