"use client";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  listConversations, recordReelShare, sendConversationMessage, type ConversationSummary, type ReelPost,
} from "@/lib/api";
import { IconCopy, IconMessageCircle, IconWhatsApp, IconX } from "@/components/Icons";

export function videoShareUrl(locale: string, postId: string) {
  return `${window.location.origin}/${locale}/videos/${postId}`;
}

function conversationName(c: ConversationSummary) {
  return c.participants_details?.[0]?.full_name || c.participant_usernames.join(", ");
}

/**
 * Share one video: copy its link, open WhatsApp, or drop it straight into an Oaziland
 * chat. In chat the link turns into a tappable video card (see ChatLinkText).
 */
export default function ShareSheet({
  post, loggedIn, onClose, onShared,
}: {
  post: ReelPost;
  loggedIn: boolean;
  onClose: () => void;
  onShared: (postId: string, shareCount: number) => void;
}) {
  const t = useTranslations("VideosPage");
  const locale = useLocale();
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [filter, setFilter] = useState("");
  const [copied, setCopied] = useState(false);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    let cancelled = false;
    listConversations(token)
      .then((data) => { if (!cancelled) setConversations(data.results); })
      .catch(() => { if (!cancelled) setConversations([]); });
    return () => { cancelled = true; };
  }, []);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (conversations ?? []).filter((c) => !needle || conversationName(c).toLowerCase().includes(needle));
  }, [conversations, filter]);

  function track(channel: "WHATSAPP" | "IN_APP") {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    recordReelShare(post.id, channel, token).then((r) => onShared(post.id, r.share_count)).catch(() => undefined);
  }

  async function copyLink() {
    const url = videoShareUrl(locale, post.id);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const area = document.createElement("textarea");
      area.value = url;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  async function sendInChat(conversation: ConversationSummary) {
    const token = localStorage.getItem("access_token");
    if (!token || sendingId) return;
    setSendingId(conversation.id);
    setError(false);
    try {
      await sendConversationMessage(conversation.id, t("shareMessage", { link: videoShareUrl(locale, post.id) }), token);
      setSentTo((prev) => new Set(prev).add(conversation.id));
      track("IN_APP");
    } catch {
      setError(true);
    } finally {
      setSendingId(null);
    }
  }

  const whatsappHref = () =>
    `https://wa.me/?text=${encodeURIComponent(t("shareMessage", { link: videoShareUrl(locale, post.id) }))}`;

  return (
    <div className="absolute inset-0 z-40 flex items-end md:items-center md:justify-center">
      <button type="button" aria-label={t("close")} onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div
        role="dialog" aria-modal="true" aria-label={t("shareTitle")}
        className="relative flex max-h-[80%] w-full flex-col rounded-t-3xl bg-white text-slate-900 shadow-2xl animate-rise-in md:max-h-[34rem] md:w-[26rem] md:rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-extrabold">{t("shareTitle")}</h2>
          <button type="button" onClick={onClose} aria-label={t("close")} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200">
            <IconX size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 p-4">
          <button type="button" onClick={copyLink} className="flex items-center justify-center gap-2 rounded-2xl bg-slate-100 px-3 py-3 text-sm font-bold hover:bg-slate-200">
            <IconCopy size={18} /> {copied ? t("linkCopied") : t("copyLink")}
          </button>
          <a
            href={whatsappHref()} target="_blank" rel="noopener noreferrer" onClick={() => track("WHATSAPP")}
            className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-3 py-3 text-sm font-bold text-white hover:bg-emerald-600"
          >
            <IconWhatsApp size={18} /> {t("shareWhatsapp")}
          </a>
        </div>

        <div className="flex min-h-0 flex-1 flex-col border-t border-slate-100">
          <p className="flex items-center gap-2 px-4 pt-3 text-xs font-extrabold uppercase tracking-wide text-slate-500">
            <IconMessageCircle size={14} /> {t("sendInChat")}
          </p>
          {!loggedIn ? (
            <p className="p-4 text-sm text-slate-600">
              <Link href="/login" className="font-bold text-slate-900 underline">{t("signInToChat")}</Link>
            </p>
          ) : (
            <>
              <div className="px-4 pt-2">
                <input
                  value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("chatSearch")} aria-label={t("chatSearch")}
                  className="w-full rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:border-slate-400"
                />
              </div>
              <ul className="min-h-24 flex-1 overflow-y-auto px-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
                {conversations === null && <li className="px-2 py-3 text-sm text-slate-500">{t("loading")}</li>}
                {conversations !== null && conversations.length === 0 && <li className="px-2 py-3 text-sm text-slate-500">{t("noConversations")}</li>}
                {visible.map((c) => {
                  const name = conversationName(c);
                  const done = sentTo.has(c.id);
                  return (
                    <li key={c.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-amber-300">
                        {(name.charAt(0) || "?").toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
                      <button
                        type="button" disabled={done || sendingId === c.id} onClick={() => sendInChat(c)}
                        className={`rounded-full px-4 py-1.5 text-xs font-bold ${done ? "bg-emerald-100 text-emerald-700" : "bg-slate-900 text-white disabled:opacity-50"}`}
                      >
                        {done ? t("sent") : t("send")}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {error && <p role="alert" className="px-4 pb-3 text-xs text-rose-600">{t("sendFailed")}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
