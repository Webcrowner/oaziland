"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Button from "@/components/ui/Button";
import {
  listConversations, getConversationMessages, sendConversationMessage, markConversationSeen,
  sendTypingHeartbeat, getTypingStatus,
  type ConversationSummary, type ConversationMessage,
} from "@/lib/api";

/**
 * The real in-app inbox — a two-panel layout (conversation list +
 * thread), wired to the actual messaging API. Reuses the same
 * client_message_id idempotency pattern the backend already relies
 * on, so a flaky connection retry never double-sends.
 */
export default function MessagesPage() {
  const t = useTranslations("InboxPage");
  const [loggedIn, setLoggedIn] = useState(true);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<ConversationMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [typingUsernames, setTypingUsernames] = useState<string[]>([]);
  const lastHeartbeatRef = useRef<number>(0);

  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;

  const loadConversations = useCallback(() => {
    if (!token) {
      setLoggedIn(false);
      return;
    }
    listConversations(token)
      .then((data) => setConversations(data.results))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedId || !token) return;
    getConversationMessages(selectedId, token)
      .then(setThread)
      .catch(() => {});
    markConversationSeen(selectedId, token).then(loadConversations);
  }, [selectedId, token, loadConversations]);

  // Poll the OTHER participant's typing status every 2 seconds while
  // a conversation is open — this is a REST backend, not WebSocket,
  // so polling (not push) is the real, working mechanism here.
  useEffect(() => {
    if (!selectedId || !token) return;
    const interval = setInterval(() => {
      getTypingStatus(selectedId, token).then((data) => setTypingUsernames(data.typing_usernames));
    }, 2000);
    return () => clearInterval(interval);
  }, [selectedId, token]);

  function handleDraftChange(value: string) {
    setDraft(value);
    if (!selectedId || !token) return;
    // Throttled to at most once every 3 seconds — sending a heartbeat
    // on every keystroke would be wasteful; the backend's own 8-second
    // timeout gives plenty of margin for this interval.
    const now = Date.now();
    if (now - lastHeartbeatRef.current > 3000) {
      lastHeartbeatRef.current = now;
      sendTypingHeartbeat(selectedId, token);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !token || !draft.trim()) return;
    setSending(true);
    try {
      const message = await sendConversationMessage(selectedId, draft, token);
      setThread((prev) => [...prev, message]);
      setDraft("");
      loadConversations();
    } finally {
      setSending(false);
    }
  }

  if (!loggedIn) {
    return (
      <main className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
        <Button href="/login">{t("signInRequired")}</Button>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[var(--navy)]">{t("title")}</h1>
        <Link href="/privacy-settings" className="text-sm text-gray-500 hover:text-[var(--navy)] underline">
          {t("typingSettingsLink")}
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 border rounded-lg overflow-hidden" style={{ minHeight: "500px" }}>
        {/* Conversation list */}
        <div className="border-r md:col-span-1 max-h-[500px] overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="text-gray-500 text-sm p-4">{t("noConversationsYet")}</p>
          ) : (
            conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => setSelectedId(conv.id)}
                className={`w-full text-left p-4 border-b hover:bg-gray-50 transition-colors ${selectedId === conv.id ? "bg-gray-100" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-[var(--navy)] text-sm">{conv.participant_usernames.join(", ")}</p>
                  {conv.unread_count > 0 && (
                    <span className="bg-[var(--gold)] text-[var(--navy)] text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                      {conv.unread_count}
                    </span>
                  )}
                </div>
                {conv.last_message && <p className="text-xs text-gray-500 truncate mt-1">{conv.last_message.text}</p>}
              </button>
            ))
          )}
        </div>

        {/* Thread */}
        <div className="md:col-span-2 flex flex-col">
          {!selectedId ? (
            <p className="text-gray-400 text-sm p-4 m-auto">{t("selectConversation")}</p>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 max-h-[420px]">
                {thread.map((msg) => (
                  <div key={msg.id} className="flex flex-col items-start">
                    <div className="bg-gray-100 rounded-lg px-3 py-2 max-w-xs">
                      <p className="text-sm text-gray-800">{msg.text}</p>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {msg.tick_status.seen ? t("seen") : msg.tick_status.delivered ? t("delivered") : t("sent")}
                    </p>
                  </div>
                ))}
              </div>
              {typingUsernames.length > 0 && (
                <p className="text-xs text-gray-500 italic px-3 pb-1">
                  {t("isTyping", { name: typingUsernames.join(", ") })}
                </p>
              )}
              <form onSubmit={handleSend} className="border-t p-3 flex gap-2">
                <input
                  type="text" placeholder={t("typeMessage")} className="flex-1 border rounded px-3 py-2 text-sm"
                  value={draft} onChange={(e) => handleDraftChange(e.target.value)}
                />
                <button type="submit" disabled={sending} className="bg-[var(--navy)] text-white font-semibold px-4 py-2 rounded text-sm disabled:opacity-50">
                  {sending ? t("sending") : t("send")}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
