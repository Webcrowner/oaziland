"use client";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import PageHeader from "@/components/ui/PageHeader";
import {
  STAFF_PERMISSIONS, currentStaffSession, getStaffActivity, getStaffOverview, inviteStaff, staffAction, startStaffSession,
  type StaffGrant, type StaffPermission,
} from "@/lib/api";

type Overview = { can_have_staff: boolean; my_staff: StaffGrant[]; i_help: StaffGrant[] };
const cardCls = "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm";
const inputCls = "mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium";

function PermissionPicker({ value, onChange, idPrefix }: { value: StaffPermission[]; onChange: (next: StaffPermission[]) => void; idPrefix: string }) {
  const t = useTranslations("StaffAccess");
  return (
    <fieldset>
      <legend className="text-xs font-bold text-slate-600">{t("permissionsLabel")}</legend>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {STAFF_PERMISSIONS.map((code) => {
          const id = `${idPrefix}-${code}`;
          const checked = value.includes(code);
          return (
            <label key={code} htmlFor={id} className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-sm ${checked ? "border-violet-400 bg-violet-50" : "border-slate-200"}`}>
              <input
                id={id} type="checkbox" checked={checked} className="mt-0.5 h-4 w-4 accent-violet-700"
                onChange={() => onChange(checked ? value.filter((v) => v !== code) : [...value, code])}
              />
              <span>
                <span className="block font-semibold text-slate-800">{t(`perm_${code}`)}</span>
                <span className="block text-xs text-slate-500">{t(`permHint_${code}`)}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Owners give staff limited access to their account; staff accept invitations and switch into accounts they help on. */
export default function StaffAccessPage() {
  const t = useTranslations("StaffAccess");
  const locale = useLocale();
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "signedOut" | "inSession" | "error" | "ready">("loading");
  const [data, setData] = useState<Overview | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [invite, setInvite] = useState({ identifier: "", title: "", expires_on: "", permissions: ["listings", "messages"] as StaffPermission[] });
  const [editing, setEditing] = useState<{ id: string; permissions: StaffPermission[]; title: string } | null>(null);
  const [activityFor, setActivityFor] = useState<{ id: string; rows: { method: string; path: string; status_code: number; at: string }[] } | null>(null);

  const load = useCallback(async (accessToken: string) => {
    try {
      setData(await getStaffOverview(accessToken));
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("access_token");
    void Promise.resolve().then(() => {
      if (!stored) return setState("signedOut");
      if (currentStaffSession()) return setState("inSession");
      setToken(stored);
      void load(stored);
    });
  }, [load]);

  async function run(key: string, action: () => Promise<unknown>, okText: string) {
    if (!token) return;
    setBusy(key);
    setMessage(null);
    try {
      await action();
      setMessage({ ok: true, text: okText });
      await load(token);
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("failed") });
    } finally {
      setBusy("");
    }
  }

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    await run("invite", () => inviteStaff({ ...invite, expires_on: invite.expires_on || null }, token), t("invited"));
    setInvite((prev) => ({ ...prev, identifier: "", title: "", expires_on: "" }));
  }

  async function switchInto(grant: StaffGrant) {
    if (!token) return;
    setBusy(`switch-${grant.id}`);
    try {
      await startStaffSession(grant.id, token);
      router.push("/dashboard");
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("failed") });
      setBusy("");
    }
  }

  async function showActivity(grant: StaffGrant) {
    if (!token) return;
    if (activityFor?.id === grant.id) return setActivityFor(null);
    try {
      const result = await getStaffActivity(grant.id, token);
      setActivityFor({ id: grant.id, rows: result.results });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("failed") });
    }
  }

  const date = (value: string | null) => (value ? new Date(value).toLocaleDateString(locale) : "");
  const statusBadge = (grant: StaffGrant) => {
    const tone = grant.status === "ACTIVE" ? (grant.usable ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600") : grant.status === "PENDING" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-500";
    const label = grant.status === "ACTIVE" && !grant.usable ? t("status_EXPIRED") : t(`status_${grant.status}`);
    return <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${tone}`}>{label}</span>;
  };
  const permissionList = (codes: StaffPermission[]) => codes.map((c) => t(`perm_${c}`)).join(" · ");
  const openGrants = (list: StaffGrant[]) => list.filter((g) => g.status === "PENDING" || g.status === "ACTIVE");

  return (
    <AccountSidebarLayout activeHref="/staff-access">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {state === "loading" && <p className="text-sm text-slate-500">{t("loading")}</p>}
      {state === "signedOut" && (
        <div className={`${cardCls} text-center`}>
          <p className="text-sm font-semibold text-slate-700">{t("signInRequired")}</p>
          <Link href="/login" className="mt-3 inline-block rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">{t("signIn")}</Link>
        </div>
      )}
      {state === "inSession" && <div className={cardCls}><p className="text-sm text-slate-700">{t("inSessionNotice")}</p></div>}
      {state === "error" && <div role="alert" className={cardCls}><p className="text-sm text-red-700">{t("loadFailed")}</p></div>}

      {state === "ready" && data && (
        <div className="flex flex-col gap-6">
          {message && (
            <p role={message.ok ? "status" : "alert"} className={`rounded-xl border px-4 py-2.5 text-sm font-semibold ${message.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
              {message.text}
            </p>
          )}

          {openGrants(data.i_help).length > 0 && (
            <section className={cardCls} aria-labelledby="i-help">
              <h2 id="i-help" className="text-lg font-black tracking-tight text-slate-900">{t("iHelpTitle")}</h2>
              <ul className="mt-3 divide-y divide-slate-100">
                {openGrants(data.i_help).map((grant) => (
                  <li key={grant.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900">{grant.owner.name} {grant.title && <span className="font-medium text-slate-500">· {grant.title}</span>}</p>
                      <p className="text-xs text-slate-500">{permissionList(grant.permissions)}</p>
                      <p className="mt-1 flex items-center gap-2">{statusBadge(grant)}{grant.expires_on && <span className="text-xs text-slate-500">{t("until", { date: date(grant.expires_on) })}</span>}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {grant.status === "PENDING" ? (
                        <>
                          <button type="button" disabled={!!busy} onClick={() => run(`accept-${grant.id}`, () => staffAction(grant.id, "accept", token!), t("accepted"))} className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50 cursor-pointer">{t("accept")}</button>
                          <button type="button" disabled={!!busy} onClick={() => run(`decline-${grant.id}`, () => staffAction(grant.id, "decline", token!), t("declined"))} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50 cursor-pointer">{t("decline")}</button>
                        </>
                      ) : (
                        <>
                          {grant.usable && (
                            <button type="button" disabled={!!busy} onClick={() => switchInto(grant)} className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50 cursor-pointer">
                              {busy === `switch-${grant.id}` ? t("switching") : t("switchInto", { name: grant.owner.name })}
                            </button>
                          )}
                          <button type="button" disabled={!!busy} onClick={() => run(`leave-${grant.id}`, () => staffAction(grant.id, "leave", token!), t("left"))} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50 cursor-pointer">{t("leave")}</button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className={cardCls} aria-labelledby="my-staff">
            <h2 id="my-staff" className="text-lg font-black tracking-tight text-slate-900">{t("myStaffTitle")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("myStaffHint")}</p>
            <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">🔒 {t("neverAllowed")}</p>

            {data.my_staff.length > 0 && (
              <ul className="mt-4 divide-y divide-slate-100">
                {data.my_staff.map((grant) => (
                  <li key={grant.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900">{grant.staff.name} <span className="font-medium text-slate-500">@{grant.staff.username}</span>{grant.title && <span className="font-medium text-slate-500"> · {grant.title}</span>}</p>
                        <p className="text-xs text-slate-500">{permissionList(grant.permissions)}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-2">
                          {statusBadge(grant)}
                          {grant.expires_on && <span className="text-xs text-slate-500">{t("until", { date: date(grant.expires_on) })}</span>}
                          {grant.ended_at && <span className="text-xs text-slate-500">{t("endedOn", { date: date(grant.ended_at) })}</span>}
                        </p>
                      </div>
                      {(grant.status === "PENDING" || grant.status === "ACTIVE") && (
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => setEditing(editing?.id === grant.id ? null : { id: grant.id, permissions: grant.permissions, title: grant.title })} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold cursor-pointer">{t("edit")}</button>
                          <button type="button" onClick={() => showActivity(grant)} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold cursor-pointer">{t("activity")}</button>
                          <button type="button" disabled={!!busy} onClick={() => run(`remove-${grant.id}`, () => staffAction(grant.id, "remove", token!), t("removed"))} className="rounded-xl border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50 cursor-pointer">{t("remove")}</button>
                        </div>
                      )}
                    </div>

                    {editing?.id === grant.id && (
                      <form
                        className="mt-3 flex flex-col gap-3 rounded-2xl border border-violet-200 bg-violet-50/40 p-4"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          await run(`update-${grant.id}`, () => staffAction(grant.id, "update", token!, { permissions: editing.permissions, title: editing.title }), t("updated"));
                          setEditing(null);
                        }}
                      >
                        <label className="text-xs font-bold text-slate-600 max-w-sm">{t("titleLabel")}<input value={editing.title} maxLength={80} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className={inputCls} /></label>
                        <PermissionPicker value={editing.permissions} onChange={(permissions) => setEditing({ ...editing, permissions })} idPrefix={`edit-${grant.id}`} />
                        <div className="flex gap-2">
                          <button type="submit" disabled={!!busy || editing.permissions.length === 0} className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50 cursor-pointer">{t("save")}</button>
                          <button type="button" onClick={() => setEditing(null)} className="text-sm font-semibold text-slate-600 cursor-pointer">{t("cancel")}</button>
                        </div>
                      </form>
                    )}

                    {activityFor?.id === grant.id && (
                      <div className="mt-3 rounded-2xl border border-slate-200 p-3">
                        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{t("activityTitle")}</p>
                        {activityFor.rows.length === 0 ? (
                          <p className="text-sm text-slate-500">{t("activityEmpty")}</p>
                        ) : (
                          <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
                            {activityFor.rows.map((row, i) => (
                              <li key={i} className="flex flex-wrap gap-x-3">
                                <time className="text-slate-500">{new Date(row.at).toLocaleString(locale)}</time>
                                <span className="font-mono text-slate-800">{row.method} {row.path.replace(/^\/api/, "")}</span>
                                <span className={row.status_code < 400 ? "text-emerald-700" : "text-red-700"}>{row.status_code < 400 ? t("activityDone") : t("activityRefused")}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {data.can_have_staff ? (
              <form onSubmit={submitInvite} className="mt-5 flex flex-col gap-4 border-t border-slate-100 pt-5" aria-labelledby="invite-title">
                <h3 id="invite-title" className="text-base font-black text-slate-900">{t("inviteTitle")}</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="text-xs font-bold text-slate-600">{t("identifierLabel")}<input required value={invite.identifier} placeholder={t("identifierPlaceholder")} onChange={(e) => setInvite({ ...invite, identifier: e.target.value })} className={inputCls} /></label>
                  <label className="text-xs font-bold text-slate-600">{t("titleLabel")}<input value={invite.title} maxLength={80} placeholder={t("titlePlaceholder")} onChange={(e) => setInvite({ ...invite, title: e.target.value })} className={inputCls} /></label>
                  <label className="text-xs font-bold text-slate-600">{t("expiresLabel")}<input type="date" value={invite.expires_on} onChange={(e) => setInvite({ ...invite, expires_on: e.target.value })} className={inputCls} /></label>
                </div>
                <PermissionPicker value={invite.permissions} onChange={(permissions) => setInvite({ ...invite, permissions })} idPrefix="invite" />
                <button type="submit" disabled={busy === "invite" || invite.permissions.length === 0} className="self-start rounded-xl bg-violet-700 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 cursor-pointer">
                  {busy === "invite" ? t("inviting") : t("invite")}
                </button>
              </form>
            ) : (
              <p className="mt-4 text-sm text-slate-600">{t("kycFirst")} <Link href="/kyc" className="font-semibold underline">{t("kycLink")}</Link></p>
            )}
          </section>
        </div>
      )}
    </AccountSidebarLayout>
  );
}
