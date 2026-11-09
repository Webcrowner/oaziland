"use client";
import DataAdminLink, { dataAdminPath } from "@/components/admin/DataAdminLink";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  approveVerificationRequest,
  listAdminVerificationRequests,
  rejectVerificationRequest,
  type AdminVerificationFlag,
  type AdminVerificationRequest,
  type AdminVerificationState,
} from "@/lib/api";
import AdminCaterers from "@/components/admin/AdminCaterers";
import type { useAdminDialogs } from "@/components/admin/useAdminDialogs";

interface Props {
  token: string;
  dialogs: ReturnType<typeof useAdminDialogs>;
  /** Lets the console refresh its counters after a request is reviewed. */
  onChanged: () => void;
}

const STATES: AdminVerificationState[] = ["pending", "approved", "rejected"];
const TYPES = [
  "AGENT_VERIFICATION",
  "AGENCY_VERIFICATION",
  "LANDLORD_VERIFICATION",
  "HOSTEL_VERIFICATION",
  "GUEST_HOUSE_VERIFICATION",
  "BUSINESS_VERIFICATION",
  "VEHICLE_OWNERSHIP",
  "IDENTITY_VERIFICATION",
];
// Flags that should make a reviewer stop and look before approving.
const SERIOUS: AdminVerificationFlag[] = ["subject_missing", "not_owner", "no_document", "previously_rejected", "role_missing"];

/** The verification queue, with enough context (the subject, its owner, the requester's history and warning flags) to decide. */
export default function AdminVerificationQueue({ token, dialogs, onChanged }: Props) {
  const t = useTranslations("AdminConsolePage");
  const [section, setSection] = useState<"requests" | "caterers">("requests");
  const [state, setState] = useState<AdminVerificationState>("pending");
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AdminVerificationRequest[]>([]);
  const [count, setCount] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAdminVerificationRequests({ state, type, q: query, page }, token);
      setItems(data.results || []);
      setCount(data.count || 0);
      setHasNext(Boolean(data.next));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [state, type, query, page, token]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function finish(res: Response) {
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      await dialogs.notify(typeof body?.detail === "string" ? body.detail : t("actionFailed"));
    }
    await load();
    onChanged();
  }

  async function handleApprove(item: AdminVerificationRequest) {
    const warnings = item.flags.filter((f) => SERIOUS.includes(f)).map((f) => t(`verifyFlag_${f}`));
    const message =
      t("verifyApproveConfirm", { name: item.requester.name }) + (warnings.length ? `\n\n${t("verifyApproveWarnings")}\n• ${warnings.join("\n• ")}` : "");
    if (!(await dialogs.confirm(message, { confirmLabel: t("approve") }))) return;
    setBusyId(item.id);
    try {
      await finish(await approveVerificationRequest(item.id, token));
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(item: AdminVerificationRequest) {
    const reason = await dialogs.ask(t("verifyRejectPrompt", { name: item.requester.name }), {
      multiline: true,
      required: true,
      confirmLabel: t("reject"),
      validate: (value) => (value.trim().length > 300 ? t("verifyReasonTooLong") : null),
    });
    if (reason === null) return;
    setBusyId(item.id);
    try {
      await finish(await rejectVerificationRequest(item.id, reason.trim(), token));
    } finally {
      setBusyId(null);
    }
  }

  const label = (prefix: string, key: string) => (t.has(`${prefix}_${key}`) ? t(`${prefix}_${key}`) : key);
  const pill = (active: boolean) =>
    `rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors ${active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`;
  const kycStyle: Record<string, string> = {
    VERIFIED: "bg-emerald-100 text-emerald-800",
    PENDING: "bg-amber-100 text-amber-800",
    REJECTED: "bg-rose-100 text-rose-800",
    NONE: "bg-slate-100 text-slate-600",
  };
  const fieldClass =
    "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-amber-500 focus:outline-none";

  const sectionSwitch = (
    <div className="flex flex-wrap gap-2">
      {(["requests", "caterers"] as const).map((value) => (
        <button key={value} onClick={() => setSection(value)} className={pill(section === value)}>
          {t(`verifySection_${value}`)}
        </button>
      ))}
    </div>
  );

  if (section === "caterers") {
    return (
      <div className="space-y-4 animate-rise-in">
        {sectionSwitch}
        <AdminCaterers token={token} dialogs={dialogs} />
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-rise-in">
      {sectionSwitch}
      <p className="max-w-3xl text-xs leading-relaxed text-slate-500">{t("verifyIntro")}</p>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/80 pb-3">
        {STATES.map((value) => (
          <button
            key={value}
            onClick={() => {
              setState(value);
              setPage(1);
            }}
            className={pill(state === value)}
          >
            {t(`verifyState_${value}`)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          {t("verifyType")}
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
            className={fieldClass}
          >
            <option value="">{t("verifyAllTypes")}</option>
            {TYPES.map((value) => (
              <option key={value} value={value}>
                {label("verifyType", value)}
              </option>
            ))}
          </select>
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQuery(search.trim());
          }}
          className="flex min-w-[14rem] grow gap-2 sm:max-w-md"
        >
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("verifySearchPlaceholder")}
            className={`${fieldClass} min-w-0 grow`}
          />
          <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800">
            {t("auditApply")}
          </button>
        </form>
      </div>

      <p className="text-xs font-semibold text-slate-500">{loading ? t("usersLoading") : t("contentCount", { count })}</p>

      {failed ? (
        <div className="rounded-2xl border border-dashed border-rose-200 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-rose-700">{t("verifyLoadError")}</p>
        </div>
      ) : !loading && items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
          <p className="mt-1 text-xs text-slate-400">{t(`verifyEmpty_${state}`)}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const serious = item.flags.some((f) => SERIOUS.includes(f));
            const owner = item.subject.owner;
            return (
              <li key={item.id} className={`rounded-2xl border bg-white p-5 shadow-sm ${serious && item.status === "PENDING" ? "border-amber-300" : "border-slate-200/80"}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-[10px] font-bold text-white">{label("verifyType", item.request_type)}</span>
                      <span className="text-[11px] text-slate-400">
                        {t("verifySubmitted", { date: new Date(item.submitted_at).toLocaleString() })}
                      </span>
                      <DataAdminLink path={dataAdminPath.verificationRequest(item.id)} />
                    </div>

                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t("verifySubject")}</p>
                      {item.subject.found ? (
                        <>
                          <p className="mt-0.5 break-words text-sm font-bold text-slate-900">
                            {item.subject.title}
                            <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600">{label("verifyKind", item.subject.kind)}</span>
                          </p>
                          {item.subject.excerpt && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.subject.excerpt}</p>}
                          <p className="mt-1 text-xs text-slate-500">
                            {t("verifyOwner")}:{" "}
                            <span className="font-semibold text-slate-700">{owner ? `${owner.name} (@${owner.username})` : "—"}</span>
                          </p>
                          {Object.entries(item.subject.facts ?? {}).length > 0 && (
                            <p className="mt-1 flex flex-wrap gap-1.5">
                              {Object.entries(item.subject.facts).map(([key, value]) => (
                                <span key={key} className="rounded-lg bg-white px-2 py-0.5 text-[11px] text-slate-600">
                                  <span className="font-semibold text-slate-500">{label("verifyFact", key)}:</span>{" "}
                                  {value === "" ? t("verifyFactIndependent") : String(value)}
                                </span>
                              ))}
                            </p>
                          )}
                          {item.subject.path && (
                            <Link href={item.subject.path} target="_blank" className="mt-1.5 inline-block text-xs font-bold text-amber-700 hover:underline">
                              {t("verifyOpenSubject")} ↗
                            </Link>
                          )}
                        </>
                      ) : (
                        <p className="mt-0.5 text-sm font-semibold text-rose-700">{t("verifySubjectGone")}</p>
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-100 p-3.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t("verifyRequester")}</p>
                      <p className="mt-0.5 text-sm font-bold text-slate-900">
                        {item.requester.name} <span className="font-medium text-slate-500">@{item.requester.username}</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {[item.requester.phone, item.requester.email].filter(Boolean).join(" · ")}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${kycStyle[item.requester.kyc_status] ?? kycStyle.NONE}`}>
                          {t("verifyKyc", { status: label("verifyKycStatus", item.requester.kyc_status) })}
                        </span>
                        {item.requester.strikes > 0 && (
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                            {t("verifyStrikes", { count: item.requester.strikes })}
                          </span>
                        )}
                        <span className="text-[11px] text-slate-400">
                          {t("verifyMemberSince", { date: new Date(item.requester.joined_at).toLocaleDateString() })} ·{" "}
                          {t("verifyHistory", {
                            total: item.requester.requests_total,
                            approved: item.requester.requests_approved,
                            rejected: item.requester.requests_rejected,
                          })}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {item.document ? (
                        <a
                          href={item.document.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg bg-slate-100 px-3 py-1.5 font-bold text-slate-700 hover:bg-slate-200"
                        >
                          {t("viewDocument")} ↗ <span className="font-medium text-slate-500">({item.document.host})</span>
                        </a>
                      ) : (
                        <span className="text-slate-400">{t("verifyNoDocument")}</span>
                      )}
                    </div>

                    {item.flags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {item.flags.map((flag) => (
                          <span
                            key={flag}
                            className={`rounded-lg px-2 py-1 text-[11px] font-bold ${SERIOUS.includes(flag) ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}
                          >
                            {t(`verifyFlag_${flag}`)}
                          </span>
                        ))}
                      </div>
                    )}

                    {item.status !== "PENDING" && (
                      <p
                        className={`rounded-lg border px-3 py-1.5 text-xs ${
                          item.status === "APPROVED" ? "border-emerald-100 bg-emerald-50 text-emerald-900" : "border-rose-100 bg-rose-50 text-rose-900"
                        }`}
                      >
                        <span className="font-bold">
                          {t(item.status === "APPROVED" ? "verifyApprovedBy" : "verifyRejectedBy", { name: item.reviewed_by || "—" })}
                        </span>
                        {item.reviewed_at ? ` · ${new Date(item.reviewed_at).toLocaleString()}` : ""}
                        {item.rejection_reason ? `: ${item.rejection_reason}` : ""}
                      </p>
                    )}
                  </div>

                  {item.status === "PENDING" && (
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => handleApprove(item)}
                        disabled={busyId === item.id}
                        className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {t("approve")}
                      </button>
                      <button
                        onClick={() => handleReject(item)}
                        disabled={busyId === item.id}
                        className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-rose-500 disabled:opacity-50"
                      >
                        {t("reject")}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {count > 0 && (
        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("previous")}
          </button>
          <span className="text-xs font-medium text-slate-500">{t("pageN", { n: page })}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasNext || loading}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("next")}
          </button>
        </div>
      )}
    </div>
  );
}
