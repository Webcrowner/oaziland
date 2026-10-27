"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { IconMessageCircle } from "@/components/Icons";
import { useRouter, Link } from "@/i18n/navigation";
import {
  startSupportChat, continueSupportChat, askChatbotAnonymously,
  type SupportMessageItem,
} from "@/lib/api";

/**
 * A real, platform-wide AI support chatbot (Oazi) — engagement.
 * SupportTicket/SupportMessage + the AI support agent were fully
 * built and unit-tested, but had zero endpoint or UI anywhere before
 * this. Floating widget, available on every page via the locale
 * layout, so it's always one click away regardless of what a user is
 * currently looking at.
 *
 * WHY signing in is NOT required: a visitor comparing listings/prices
 * before ever registering is a real, common case — the same reasoning
 * ContactMessageView already uses. Anonymous turns hit the stateless
 * /api/chatbot/ask/ endpoint (nothing persisted server-side, since a
 * SupportTicket always needs a real owner); once signed in, messages
 * go through the real, saved SupportTicket conversation instead.
 */

// The AI replies with **bold** and [label](link) links. Only links that stay on this site become buttons
// (an absolute URL is accepted only when it points at our own origin), so a model slip can never
// produce an external or javascript: link.
const MESSAGE_TOKENS =
  /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s)<>"]+|\/(?:listing|hotels|student-hostels|guest-houses|events|search|marketplace|taskln-service|oazigo)[^\s)<>"]*)/g;

/** Returns an in-site path (without the locale prefix) or null for anything external/unsafe. */
function toSitePath(rawHref: string): string | null {
  const href = rawHref.replace(/[`'"]+$/, "");
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  try {
    const url = new URL(href);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname.replace(/^\/(en|fr)(?=\/|$)/, "") || "/"}${url.search}`;
  } catch {
    return null;
  }
}

function friendlyLabel(path: string, label?: string): string {
  if (label && !/^(https?:)?\//.test(label.trim()) && label.length <= 60) return label;
  const route = path.split("?")[0];
  const hasId = /^\/(listing|hotels|student-hostels|guest-houses|events)\/[^/]+$/.test(route);
  if (route.startsWith("/listing")) return "View listing";
  if (route.startsWith("/hotels")) return hasId ? "View hotel" : "Browse hotels";
  if (route.startsWith("/student-hostels")) return hasId ? "View hostel" : "Browse student hostels";
  if (route.startsWith("/guest-houses")) return hasId ? "View guest house" : "Browse guest houses";
  if (route.startsWith("/events")) return hasId ? "View venue" : "Browse event venues";
  if (route.startsWith("/search")) return path.includes("quarter=") ? "Browse this area" : "Browse properties";
  return "Open page";
}

function ChatLinkButton({ path, label, onNavigate }: { path: string; label?: string; onNavigate: () => void }) {
  return (
    <Link
      href={path}
      onClick={onNavigate}
      className="inline-flex items-center gap-1.5 my-1 px-3 py-1.5 rounded-lg bg-[var(--navy)] text-white text-xs font-bold no-underline shadow-sm hover:opacity-90 transition-opacity"
    >
      {friendlyLabel(path, label)}
      <span aria-hidden="true">→</span>
    </Link>
  );
}

function FormattedMessageText({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  return (
    <>
      {text.split(MESSAGE_TOKENS).map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i}><FormattedMessageText text={part.slice(2, -2)} onNavigate={onNavigate} /></strong>;
        }
        const markdownLink = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
        if (markdownLink) {
          const path = toSitePath(markdownLink[2]);
          return path
            ? <ChatLinkButton key={i} path={path} label={markdownLink[1]} onNavigate={onNavigate} />
            : <span key={i}>{markdownLink[1]}</span>;
        }
        if (part.startsWith("/") || /^https?:\/\//.test(part)) {
          const path = toSitePath(part);
          return path ? <ChatLinkButton key={i} path={path} onNavigate={onNavigate} /> : <span key={i}>{part}</span>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export default function SupportChatWidget() {
  const t = useTranslations("SupportLauncher");
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [aiHandled, setAiHandled] = useState(true);
  const [messages, setMessages] = useState<SupportMessageItem[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const nextLocalId = useRef(-1);

  useEffect(() => {
    const hasToken = !!localStorage.getItem("access_token");
    void Promise.resolve().then(() => setIsSignedIn(hasToken));
  }, [isOpen]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending) return;

    const token = localStorage.getItem("access_token");
    setSending(true);
    setError("");
    setDraft("");

    if (!token) {
      const userMessage: SupportMessageItem = { id: nextLocalId.current--, sender_type: "USER", text, sent_at: new Date().toISOString() };
      const historyForRequest = messages.map((m) => ({ sender_type: m.sender_type, text: m.text }));
      setMessages((prev) => [...prev, userMessage]);
      try {
        const reply = await askChatbotAnonymously(text, historyForRequest);
        setAiHandled(!reply.should_escalate_to_human);
        setMessages((prev) => [
          ...prev,
          { id: nextLocalId.current--, sender_type: "AI_AGENT", text: reply.response_text, sent_at: new Date().toISOString() },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not reach Oazi right now.");
        setDraft(text);
      } finally {
        setSending(false);
      }
      return;
    }

    try {
      // Show the user's own message immediately; the server's copy replaces it once the reply arrives.
      const optimistic: SupportMessageItem = { id: nextLocalId.current--, sender_type: "USER", text, sent_at: new Date().toISOString() };
      setMessages((prev) => [...prev, optimistic]);
      try {
        const ticket = ticketId
          ? await continueSupportChat(ticketId, text, token)
          : await startSupportChat(text, token);
        setTicketId(ticket.id);
        setAiHandled(ticket.ai_handled);
        setMessages(ticket.messages || []);
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        throw err;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not reach Oazi right now.";
      setError(message);
      setDraft(text);
      if (message.includes("session has expired")) {
        setIsSignedIn(false);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div data-open={isOpen} className={`support-widget z-50 flex flex-col items-end gap-3 ${isOpen ? "fixed bottom-5 right-4 md:right-5" : "relative mx-auto my-6 w-fit md:fixed md:bottom-5 md:right-5 md:m-0"}`}>
      {isOpen && (
        <div className="w-[min(92vw,360px)] h-[min(70vh,520px)] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
          <div className="bg-[var(--navy)] text-white px-4 py-3 flex items-center justify-between">
            <div>
              <p className="font-bold text-sm">Oazi — Oaziland Support</p>
              <p className="text-[11px] text-white/70">{aiHandled ? "AI assistant" : "Connected to our team"}</p>
            </div>
            <button aria-label={t("close")} onClick={() => setIsOpen(false)} className="min-h-11 min-w-11 text-white/80 hover:text-white text-lg leading-none">
              ×
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2 bg-slate-50">
            {messages.length === 0 ? (
              <p className="m-auto text-sm text-slate-400 text-center px-6">
                Ask me about listings, hotels, student hostels, services, or your best options on Oaziland — no account needed.
              </p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[85%] px-3 py-2 rounded-xl text-sm whitespace-pre-wrap ${
                    m.sender_type === "USER"
                      ? "self-end bg-[var(--navy)] text-white"
                      : "self-start bg-white border border-slate-200 text-slate-700"
                  }`}
                >
                  <FormattedMessageText text={m.text} onNavigate={() => setIsOpen(false)} />
                </div>
              ))
            )}
            {sending && (
              <div className="self-start flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2.5" role="status" aria-live="polite">
                <span className="flex items-center gap-1" aria-hidden="true">
                  <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" />
                </span>
                <span className="text-xs text-slate-500">Oazi is typing…</span>
              </div>
            )}
            {!isSignedIn && (
              <p className="text-center text-[11px] text-slate-400 px-4">
                <button onClick={() => router.push("/login")} className="underline hover:text-slate-600">Sign in</button> to save this conversation to your account.
              </p>
            )}
          </div>

          <div className="border-t border-slate-200 p-2.5">
            {error && <p className="text-xs text-red-600 mb-1.5 px-1">{error}</p>}
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Type your question..."
                readOnly={sending}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm read-only:opacity-60"
              />
              <button
                onClick={handleSend}
                disabled={sending || !draft.trim()}
                className="bg-[var(--navy)] text-white text-xs font-bold px-3.5 rounded-lg disabled:opacity-50 min-w-[3.5rem] flex items-center justify-center"
                aria-label={sending ? "Sending" : "Send"}
              >
                {sending ? (
                  <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                ) : (
                  "Send"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setIsOpen((v) => !v)}
        className="min-h-11 rounded-full bg-[var(--navy)] px-4 py-3 text-white shadow-lg flex items-center justify-center gap-2 hover:opacity-90 transition-opacity md:w-14 md:h-14 md:p-0"
        aria-label={isOpen ? t("close") : t("open")}
        aria-expanded={isOpen}
      >
        {isOpen ? <span aria-hidden="true">×</span> : <IconMessageCircle size={22} />}
        <span className="text-sm font-semibold md:hidden">{isOpen ? t("close") : t("open")}</span>
      </button>
    </div>
  );
}
