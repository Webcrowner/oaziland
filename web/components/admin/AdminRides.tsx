"use client";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  listAdminRideIssues, resolveAdminRideIssue, listAdminRides, getAdminRide,
  type AdminRide, type AdminRideDetail, type AdminRideIssue,
} from "@/lib/api";

const RIDE_STATUSES = ["REQUESTED", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;

const statusStyle: Record<string, string> = {
  REQUESTED: "bg-amber-100 text-amber-800",
  ACCEPTED: "bg-sky-100 text-sky-800",
  IN_PROGRESS: "bg-sky-100 text-sky-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-slate-200 text-slate-700",
};

interface Props {
  token: string;
  /** A trip to open straight away, e.g. when coming from an SOS card. */
  initialRideId?: string | null;
  /** Called with the number of open problem reports whenever it changes, for the tab badge. */
  onOpenIssueCount: (count: number) => void;
}

/** OaziGo trips for admins: the queue of problem reports, a trip search, and a full trip view. */
export default function AdminRides({ token, initialRideId = null, onOpenIssueCount }: Props) {
  const t = useTranslations("AdminConsolePage");
  const tOz = useTranslations("OaziGoPage");
  const locale = useLocale();
  const [view, setView] = useState<"issues" | "search">("issues");
  const [issues, setIssues] = useState<AdminRideIssue[]>([]);
  const [issuesState, setIssuesState] = useState<"loading" | "ready" | "error">("loading");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [resolving, setResolving] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [onlyOpenIssues, setOnlyOpenIssues] = useState(false);
  const [rides, setRides] = useState<AdminRide[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  const [selectedId, setSelectedId] = useState<string | null>(initialRideId);
  const [detail, setDetail] = useState<AdminRideDetail | null>(null);
  const [detailState, setDetailState] = useState<"loading" | "ready" | "error">("loading");

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "—");
  const xaf = (value: string) => `${Number(value).toLocaleString(locale)} XAF`;

  const loadIssues = useCallback(() => {
    setIssuesState("loading");
    listAdminRideIssues(token)
      .then((data) => {
        setIssues(data.results);
        onOpenIssueCount(data.count);
        setIssuesState("ready");
      })
      .catch(() => setIssuesState("error"));
  }, [token, onOpenIssueCount]);

  useEffect(() => {
    void Promise.resolve().then(loadIssues);
  }, [loadIssues]);

  const search = useCallback(
    async (pageNumber: number) => {
      setSearchState("loading");
      try {
        const data = await listAdminRides(token, { q: query.trim(), status: statusFilter, hasOpenIssue: onlyOpenIssues, page: pageNumber });
        setRides((prev) => (pageNumber === 1 ? data.results : [...prev, ...data.results]));
        setPage(pageNumber);
        setHasMore(Boolean(data.next));
        setSearchState("ready");
      } catch {
        setSearchState("error");
      }
    },
    [token, query, statusFilter, onlyOpenIssues],
  );

  useEffect(() => {
    if (view === "search" && searchState === "idle") void Promise.resolve().then(() => search(1));
  }, [view, searchState, search]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    void Promise.resolve()
      .then(() => {
        setDetailState("loading");
        return getAdminRide(selectedId, token);
      })
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        setDetailState("ready");
      })
      .catch(() => {
        if (!cancelled) setDetailState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, token]);

  async function handleResolve(issue: AdminRideIssue) {
    setResolving(issue.id);
    setActionError("");
    try {
      await resolveAdminRideIssue(issue.id, (notes[issue.id] || "").trim(), token);
      setIssues((prev) => {
        const next = prev.filter((i) => i.id !== issue.id);
        onOpenIssueCount(next.length);
        return next;
      });
      if (selectedId === issue.ride) setSelectedId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("ridesActionFailed"));
    } finally {
      setResolving(null);
    }
  }

  function openRide(id: string) {
    setSelectedId(id);
    setDetail(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const tabBtn = (active: boolean) =>
    `px-4 py-2 rounded-xl text-xs font-bold transition-colors ${active ? "bg-slate-900 text-amber-300" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`;

  return (
    <div className="space-y-4 animate-rise-in">
      {selectedId && (
        <section className="rounded-2xl border border-slate-300 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-black text-slate-900">{t("ridesTripTitle")}</h3>
              <p className="font-mono text-[11px] text-slate-400 break-all">{selectedId}</p>
            </div>
            <button type="button" onClick={() => setSelectedId(null)} className="shrink-0 text-xs font-bold text-slate-500 hover:text-slate-900">
              ✕ {t("ridesClose")}
            </button>
          </div>
          {detailState === "loading" ? (
            <div className="h-40 rounded-xl bg-slate-100 animate-pulse" />
          ) : detailState === "error" || !detail ? (
            <p role="alert" className="text-sm text-red-700">{t("ridesLoadFailed")}</p>
          ) : (
            <RideDetail detail={detail} fmt={fmt} xaf={xaf} />
          )}
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setView("issues")} className={tabBtn(view === "issues")}>
          {t("ridesOpenReports")} {issues.length > 0 && <span className="ml-1 rounded-full bg-rose-500 px-1.5 text-white">{issues.length}</span>}
        </button>
        <button type="button" onClick={() => setView("search")} className={tabBtn(view === "search")}>{t("ridesFindTrip")}</button>
      </div>

      {actionError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{actionError}</p>}

      {view === "issues" &&
        (issuesState === "loading" ? (
          <div className="h-32 rounded-2xl bg-slate-100 animate-pulse" />
        ) : issuesState === "error" ? (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
            <span>{t("ridesLoadFailed")}</span>
            <button type="button" onClick={loadIssues} className="font-bold underline">{t("ridesRetry")}</button>
          </div>
        ) : issues.length === 0 ? (
          <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
            <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
            <p className="text-xs text-slate-400 mt-1">{t("ridesNoReports")}</p>
          </div>
        ) : (
          issues.map((issue) => (
            <article key={issue.id} className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-black uppercase text-amber-900">
                  {tOz(`issueCategory_${issue.category}`)}
                </span>
                <span className="text-sm font-bold text-slate-900">
                  {issue.reported_by?.name} <span className="font-normal text-slate-500">({issue.reported_by?.phone})</span>
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                  {issue.reporter_role === "RIDER" ? t("sosRider") : t("sosDriver")}
                </span>
                <span className="text-[11px] text-slate-400">{fmt(issue.created_at)}</span>
              </div>
              <p className="mt-2 text-sm text-slate-800">&ldquo;{issue.description}&rdquo;</p>
              <p className="mt-1.5 text-xs text-slate-500">
                {issue.ride_summary.pickup_description} → {issue.ride_summary.dropoff_description} · {xaf(issue.ride_summary.fare_estimate_xaf)} ·{" "}
                {issue.ride_summary.status.replace("_", " ")}
              </p>
              <div className="mt-3 flex flex-col gap-2 md:flex-row">
                <input
                  value={notes[issue.id] || ""}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [issue.id]: e.target.value }))}
                  maxLength={1000}
                  placeholder={t("ridesResolutionPlaceholder")}
                  aria-label={t("ridesResolutionPlaceholder")}
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs"
                />
                <button type="button" onClick={() => openRide(issue.ride)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
                  {t("ridesViewTrip")}
                </button>
                <button
                  type="button"
                  onClick={() => handleResolve(issue)}
                  disabled={resolving === issue.id}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {t("markResolved")}
                </button>
              </div>
            </article>
          ))
        ))}

      {view === "search" && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void search(1);
            }}
            className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 md:flex-row md:items-center"
          >
            <input
              type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={t("ridesSearchPlaceholder")} aria-label={t("ridesSearchPlaceholder")}
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={t("ridesStatusFilter")} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <option value="">{t("ridesAllStatuses")}</option>
              {RIDE_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </select>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              <input type="checkbox" checked={onlyOpenIssues} onChange={(e) => setOnlyOpenIssues(e.target.checked)} />
              {t("ridesOnlyWithReports")}
            </label>
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-amber-300 hover:bg-slate-800">{t("ridesSearch")}</button>
          </form>

          {searchState === "error" ? (
            <p role="alert" className="text-sm text-red-700">{t("ridesLoadFailed")}</p>
          ) : searchState === "loading" && rides.length === 0 ? (
            <div className="h-32 rounded-2xl bg-slate-100 animate-pulse" />
          ) : rides.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-white">
              <p className="text-sm font-semibold text-slate-600">{t("ridesNoTrips")}</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {rides.map((ride) => (
                <li key={ride.id}>
                  <button type="button" onClick={() => openRide(ride.id)} className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-slate-50 md:flex-row md:items-center md:justify-between">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${statusStyle[ride.status] || "bg-slate-100 text-slate-700"}`}>
                          {ride.status.replace("_", " ")}
                        </span>
                        {ride.open_issue_count > 0 && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-900">
                            {t("ridesOpenReportCount", { count: ride.open_issue_count })}
                          </span>
                        )}
                        {ride.sos_raised_at && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-800">SOS</span>}
                        <span className="text-[11px] text-slate-400">{fmt(ride.requested_at)}</span>
                      </span>
                      <span className="mt-1 block truncate text-sm font-bold text-slate-900">
                        {ride.pickup_description} → {ride.dropoff_description}
                      </span>
                      <span className="block text-[11px] text-slate-500">
                        {t("sosRider")}: {ride.rider?.name} ({ride.rider?.phone})
                        {ride.driver && <> · {t("sosDriver")}: {ride.driver.name} ({ride.driver.phone})</>}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-black text-slate-900">{xaf(ride.fare_estimate_xaf)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hasMore && (
            <button
              type="button" onClick={() => search(page + 1)} disabled={searchState === "loading"}
              className="mx-auto block rounded-xl border border-slate-200 bg-white px-6 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {t("ridesLoadMore")}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function RideDetail({ detail, fmt, xaf }: { detail: AdminRideDetail; fmt: (iso: string | null) => string; xaf: (v: string) => string }) {
  const t = useTranslations("AdminConsolePage");
  const tOz = useTranslations("OaziGoPage");
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-semibold text-slate-900">{value}</span>
    </div>
  );
  const person = (p: AdminRideDetail["rider"]) => (p ? `${p.name} (${p.phone})` : "—");

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div>
        <p className="mb-2 text-sm font-bold text-slate-900">{detail.pickup_description} → {detail.dropoff_description}</p>
        {row(t("ridesStatus"), detail.status.replace("_", " "))}
        {row(t("ridesCategory"), `${tOz(`category_${detail.ride_category}`)}${detail.transport_type === "CARGO" ? ` · ${tOz("transportCargo")}` : ""}`)}
        {row(t("ridesFare"), `${xaf(detail.fare_estimate_xaf)}${detail.distance_km ? ` · ${Number(detail.distance_km)} km` : ""}`)}
        {row(t("sosRider"), person(detail.rider))}
        {row(t("sosDriver"), person(detail.driver))}
        {detail.vehicle_details && row(t("ridesVehicle"), `${detail.vehicle_details.make} ${detail.vehicle_details.model} · ${detail.vehicle_details.plate_number}`)}
        {row(t("ridesRequested"), fmt(detail.requested_at))}
        {detail.completed_at && row(t("ridesCompleted"), fmt(detail.completed_at))}
        {detail.cancelled_at && row(t("ridesCancelled"), fmt(detail.cancelled_at))}
        {detail.cancellation_reason &&
          row(t("ridesCancelReason"), `${tOz(`cancelReason_${detail.cancellation_reason}`)}${detail.cancellation_note ? ` · “${detail.cancellation_note}”` : ""}`)}
        {detail.release_reason &&
          row(t("ridesReleaseReason"), `${tOz(`releaseReason_${detail.release_reason}`)}${detail.release_note ? ` · “${detail.release_note}”` : ""}`)}
        {detail.cargo_description && row(t("ridesCargo"), detail.cargo_description)}
        {detail.payment
          ? row(
              t("ridesPayment"),
              `${xaf(detail.payment.amount_xaf)} · ${detail.payment.booking_status}${detail.payment.escrow_status ? ` / ${detail.payment.escrow_status}` : ""}${detail.payment.provider_reference ? ` · ${detail.payment.provider_reference}` : ""}`,
            )
          : row(t("ridesPayment"), t("ridesNotPaid"))}
        {detail.sos_raised_at && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
            <p className="font-bold">
              SOS · {person(detail.sos_raised_by)} · {fmt(detail.sos_raised_at)}
              {detail.sos_resolved_at ? ` · ${t("ridesSosHandled")}` : ""}
            </p>
            {detail.sos_note && <p className="mt-0.5">&ldquo;{detail.sos_note}&rdquo;</p>}
            {detail.sos_latitude && detail.sos_longitude && (
              <a href={`https://www.google.com/maps?q=${detail.sos_latitude},${detail.sos_longitude}`} target="_blank" rel="noopener noreferrer" className="font-bold underline">
                {t("sosOpenMap")}
              </a>
            )}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">{t("ridesReports")}</p>
          {detail.issue_reports.length === 0 ? (
            <p className="text-xs text-slate-400">{t("ridesNoReportsOnTrip")}</p>
          ) : (
            <ul className="space-y-2">
              {detail.issue_reports.map((r) => (
                <li key={r.id} className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
                  <p className="font-bold text-slate-900">
                    {tOz(`issueCategory_${r.category}`)} · {r.reported_by?.name} ({r.reporter_role === "RIDER" ? t("sosRider") : t("sosDriver")}) ·{" "}
                    <span className={r.status === "OPEN" ? "text-amber-700" : "text-emerald-700"}>{r.status}</span>
                  </p>
                  <p className="mt-0.5 text-slate-700">&ldquo;{r.description}&rdquo;</p>
                  {r.status === "RESOLVED" && (
                    <p className="mt-0.5 text-slate-500">
                      {r.resolved_by_name} · {fmt(r.resolved_at)}{r.resolution_notes ? ` · ${r.resolution_notes}` : ""}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">{t("ridesChat")}</p>
          {detail.messages.length === 0 ? (
            <p className="text-xs text-slate-400">{t("ridesNoChat")}</p>
          ) : (
            <ul className="max-h-72 space-y-1.5 overflow-y-auto rounded-xl bg-slate-50 p-3">
              {detail.messages.map((m) => (
                <li key={m.id} className="text-xs">
                  <span className="font-bold text-slate-900">{m.sender_name || "—"}</span>{" "}
                  <span className="text-[10px] text-slate-400">{fmt(m.created_at)}</span>
                  <p className="text-slate-700 break-words">{m.text}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
