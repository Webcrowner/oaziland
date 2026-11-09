"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  getAdminSupportTicket,
  listAdminContactMessages,
  listAdminSupportTickets,
  replyToAdminSupportTicket,
  setAdminContactMessageResolved,
  setAdminSupportTicketResolved,
  type AdminContactMessage,
  type AdminSupportTicket,
  type AdminSupportView,
} from "@/lib/api";
import type { useAdminDialogs } from "@/components/admin/useAdminDialogs";

type Section = "chats" | "contact";

interface Props {
  token: string;
  dialogs: ReturnType<typeof useAdminDialogs>;
  /** Lets the console refresh its counters after something is answered or resolved. */
  onChanged: () => void;
  awaitingCount: number;
  openContactCount: number;
}

const POLL_MS = 30000;

function timeAgo(iso: string | null, locale: string) {
  if (!iso) return "";
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(0, "second");
}

/** The admin inbox: chats that need a person (with a reply box) and messages from the public Contact Us form. */
export default function AdminSupportInbox({ token, dialogs, onChanged, awaitingCount, openContactCount }: Props) {
  const t = useTranslations("AdminConsolePage");
  const [section, setSection] = useState<Section>("chats");

  // ---- chats
  const [view, setView] = useState<AdminSupportView>("awaiting");
  const [tickets, setTickets] = useState<AdminSupportTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminSupportTicket | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  // ---- contact messages
  const [showResolved, setShowResolved] = useState(false);
  const [contacts, setContacts] = useState<AdminContactMessage[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState(false);

  const locale = typeof document !== "undefined" ? document.documentElement.lang || "en" : "en";

  const loadTickets = useCallback(async () => {
    setTicketsLoading(true);
    try {
      const data = await listAdminSupportTickets(view, token);
      setTickets(data.results || []);
      setTicketsError(false);
    } catch {
      setTicketsError(true);
    } finally {
      setTicketsLoading(false);
    }
  }, [view, token]);

  const loadDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      try {
        setDetail(await getAdminSupportTicket(id, token));
      } catch {
        setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [token]
  );

  const loadContacts = useCallback(async () => {
    setContactsLoading(true);
    try {
      const data = await listAdminContactMessages(showResolved, token);
      setContacts(data.results || []);
      setContactsError(false);
    } catch {
      setContactsError(true);
    } finally {
      setContactsLoading(false);
    }
  }, [showResolved, token]);

  useEffect(() => {
    if (section !== "chats") return;
    void Promise.resolve().then(loadTickets);
    const interval = setInterval(() => {
      loadTickets();
      if (selectedId) loadDetail(selectedId);
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [section, loadTickets, loadDetail, selectedId]);

  useEffect(() => {
    if (section !== "contact") return;
    void Promise.resolve().then(loadContacts);
  }, [section, loadContacts]);

  useEffect(() => {
    if (!selectedId) return;
    void Promise.resolve().then(() => loadDetail(selectedId));
  }, [selectedId, loadDetail]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [detail?.messages?.length, selectedId]);

  async function readError(res: Response) {
    const body = await res.json().catch(() => null);
    return typeof body?.detail === "string" ? body.detail : t("actionFailed");
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!detail || !text || busy) return;
    setBusy(true);
    try {
      const res = await replyToAdminSupportTicket(detail.id, text, token);
      if (!res.ok) {
        await dialogs.notify(await readError(res));
        return;
      }
      setDraft("");
      setDetail(await res.json());
      await loadTickets();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleTicketResolved(resolved: boolean) {
    if (!detail || busy) return;
    if (resolved && !(await dialogs.confirm(t("supportResolveConfirm", { name: detail.user.name }), { confirmLabel: t("supportResolve") }))) return;
    setBusy(true);
    try {
      const res = await setAdminSupportTicketResolved(detail.id, resolved, token);
      if (!res.ok) {
        await dialogs.notify(await readError(res));
        return;
      }
      setDetail(await res.json());
      await loadTickets();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleContactResolved(message: AdminContactMessage, resolved: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await setAdminContactMessageResolved(message.id, resolved, token);
      if (!res.ok) {
        await dialogs.notify(await readError(res));
        return;
      }
      await loadContacts();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const views: { key: AdminSupportView; label: string; count?: number }[] = [
    { key: "awaiting", label: t("supportViewAwaiting"), count: awaitingCount },
    { key: "open", label: t("supportViewOpen") },
    { key: "resolved", label: t("supportViewResolved") },
  ];

  const senderLabel = (type: string, name: string) =>
    type === "USER" ? name : type === "AI_AGENT" ? t("supportSenderAi") : t("supportSenderTeam");

  return (
    <div className="space-y-4 animate-rise-in">
      <p className="max-w-3xl text-xs leading-relaxed text-slate-500">{t("supportIntro")}</p>

      <div className="flex flex-wrap gap-2 border-b border-slate-200/80 pb-3">
        {(["chats", "contact"] as const).map((s) => {
          const count = s === "chats" ? awaitingCount : openContactCount;
          return (
            <button
              key={s}
              onClick={() => setSection(s)}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors ${
                section === s ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {s === "chats" ? t("supportSectionChats") : t("supportSectionContact")}
              {count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${section === s ? "bg-amber-400 text-slate-950" : "bg-amber-100 text-amber-900"}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {section === "chats" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22rem_1fr]">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {views.map((v) => (
                <button
                  key={v.key}
                  onClick={() => {
                    setView(v.key);
                    setSelectedId(null);
                    setDetail(null);
                  }}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors ${
                    view === v.key ? "bg-amber-500 text-slate-950" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {v.label}
                  {v.count ? ` (${v.count})` : ""}
                </button>
              ))}
            </div>

            {ticketsError ? (
              <p className="rounded-2xl border border-dashed border-rose-200 bg-white p-6 text-center text-xs font-semibold text-rose-700">{t("supportLoadError")}</p>
            ) : ticketsLoading && tickets.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-xs font-semibold text-slate-500">{t("usersLoading")}</p>
            ) : tickets.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
                <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
                <p className="mt-1 text-xs text-slate-400">{t(`supportEmpty_${view}`)}</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {tickets.map((ticket) => (
                  <li key={ticket.id}>
                    <button
                      onClick={() => setSelectedId(ticket.id)}
                      className={`w-full rounded-2xl border p-3.5 text-left shadow-sm transition-colors ${
                        selectedId === ticket.id ? "border-amber-400 bg-amber-50/50" : "border-slate-200/80 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-bold text-slate-900">{ticket.user.name}</p>
                        <span className="shrink-0 text-[10px] text-slate-400">{timeAgo(ticket.last_message_at, locale)}</span>
                      </div>
                      <p className="truncate text-xs font-semibold text-slate-600">{ticket.subject}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">{ticket.last_message_preview}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {ticket.awaiting_admin && (
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">{t("supportNeedsReply")}</span>
                        )}
                        {ticket.ai_handled && ticket.status !== "RESOLVED" && (
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800">{t("supportAiHandling")}</span>
                        )}
                        <span className="text-[10px] text-slate-400">{t("supportMessageCount", { count: ticket.message_count })}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="min-h-[24rem] rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            {!selectedId ? (
              <div className="flex h-full min-h-[24rem] items-center justify-center p-8 text-center text-sm text-slate-400">{t("supportPickChat")}</div>
            ) : detailLoading && !detail ? (
              <div className="flex h-full min-h-[24rem] items-center justify-center text-sm text-slate-400">{t("usersLoading")}</div>
            ) : !detail ? (
              <div className="flex h-full min-h-[24rem] items-center justify-center p-8 text-center text-sm font-semibold text-rose-700">{t("supportLoadError")}</div>
            ) : (
              <div className="flex h-full flex-col">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">{detail.user.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      @{detail.user.username}
                      {detail.user.phone ? ` · ${detail.user.phone}` : ""}
                      {detail.user.email ? ` · ${detail.user.email}` : ""}
                    </p>
                    <p className="mt-0.5 truncate text-xs font-semibold text-slate-600">{detail.subject}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">{t(`supportStatus_${detail.status}`)}</span>
                    {detail.status === "RESOLVED" || detail.status === "CLOSED" ? (
                      <button
                        onClick={() => handleTicketResolved(false)}
                        disabled={busy}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {t("supportReopen")}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleTicketResolved(true)}
                        disabled={busy}
                        className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {t("supportResolve")}
                      </button>
                    )}
                  </div>
                </div>

                <div ref={threadRef} className="flex max-h-[26rem] flex-1 flex-col gap-2 overflow-y-auto bg-slate-50 p-4">
                  {(detail.messages ?? []).map((m) => (
                    <div
                      key={m.id}
                      className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${
                        m.sender_type === "USER"
                          ? "self-start border border-slate-200 bg-white text-slate-800"
                          : m.sender_type === "HUMAN_AGENT"
                          ? "self-end bg-slate-900 text-white"
                          : "self-end bg-sky-50 text-sky-900"
                      }`}
                    >
                      <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide opacity-60">
                        {senderLabel(m.sender_type, detail.user.name)}
                        {m.sender_type === "HUMAN_AGENT" && m.sender_name ? ` · ${m.sender_name}` : ""} · {new Date(m.sent_at).toLocaleString()}
                      </p>
                      {m.text}
                    </div>
                  ))}
                </div>

                <form onSubmit={handleReply} className="border-t border-slate-100 p-3">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={3}
                    maxLength={4000}
                    placeholder={t("supportReplyPlaceholder")}
                    className="w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                  />
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="text-[11px] text-slate-400">{detail.ai_handled ? t("supportReplyTakesOver") : t("supportReplyNotifies")}</p>
                    <button
                      type="submit"
                      disabled={busy || !draft.trim()}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {busy ? t("refreshing") : t("supportSend")}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-1.5">
            {[false, true].map((resolved) => (
              <button
                key={String(resolved)}
                onClick={() => setShowResolved(resolved)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors ${
                  showResolved === resolved ? "bg-amber-500 text-slate-950" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                }`}
              >
                {resolved ? t("supportContactHandled") : t("supportContactNew")}
                {!resolved && openContactCount > 0 ? ` (${openContactCount})` : ""}
              </button>
            ))}
          </div>

          {contactsError ? (
            <p className="rounded-2xl border border-dashed border-rose-200 bg-white p-8 text-center text-sm font-semibold text-rose-700">{t("supportLoadError")}</p>
          ) : contactsLoading && contacts.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">{t("usersLoading")}</p>
          ) : contacts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
              <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
              <p className="mt-1 text-xs text-slate-400">{showResolved ? t("supportContactEmptyHandled") : t("supportContactEmptyNew")}</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {contacts.map((m) => (
                <li key={m.id} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900">{m.name}</p>
                      <a
                        href={`mailto:${m.email}?subject=${encodeURIComponent(t("supportMailSubject"))}`}
                        className="text-xs font-semibold text-amber-700 underline hover:text-amber-800"
                      >
                        {m.email}
                      </a>
                    </div>
                    <span className="text-[11px] text-slate-400">{new Date(m.created_at).toLocaleString()}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm text-slate-700">{m.message}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a
                      href={`mailto:${m.email}?subject=${encodeURIComponent(t("supportMailSubject"))}`}
                      className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800"
                    >
                      {t("supportContactReply")}
                    </a>
                    <button
                      onClick={() => handleContactResolved(m, !m.resolved)}
                      disabled={busy}
                      className={`rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${
                        m.resolved ? "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50" : "bg-emerald-600 text-white hover:bg-emerald-500"
                      }`}
                    >
                      {m.resolved ? t("supportReopen") : t("supportContactMarkHandled")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
