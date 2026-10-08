"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { listRideMessages, sendRideMessage, type RideMessageItem } from "@/lib/api";

const POLL_MS = 6000;

/** Private in-trip chat between rider and driver for an active ride. */
export default function RideChat({ rideId, myUserId }: { rideId: string; myUserId: string | null }) {
  const t = useTranslations("OaziGoPage");
  const [messages, setMessages] = useState<RideMessageItem[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    listRideMessages(rideId, token).then(setMessages).catch(() => {});
  }, [rideId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || !text.trim()) return;
    setError("");
    try {
      await sendRideMessage(rideId, text.trim(), token);
      setText("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    }
  }

  return (
    <div className="border border-gray-200 rounded-xl p-3 bg-slate-50 mt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
          💬 {t("rideChatTitle") || "Trip Chat"}
        </span>
        <span className="text-[10px] text-slate-400">Live</span>
      </div>
      <div className="max-h-44 overflow-y-auto flex flex-col gap-1.5 mb-2 p-1">
        {messages.length === 0 && <p className="text-xs text-gray-400 italic py-1">{t("noRideMessages") || "No messages yet. Send a message to coordinate pickup."}</p>}
        {messages.map((m) => {
          const isMe = m.sender === myUserId;
          return (
            <div
              key={m.id}
              className={`text-xs max-w-[85%] px-3 py-1.5 rounded-xl ${
                isMe ? "self-end bg-[var(--navy)] text-white" : "self-start bg-white border border-gray-200 text-gray-800"
              }`}
            >
              {!isMe && <p className="font-semibold text-[10px] opacity-75">{m.sender_name}</p>}
              <p className="break-words">{m.text}</p>
            </div>
          );
        })}
      </div>
      <form onSubmit={handleSend} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          placeholder={t("typeRideMessage") || "Type a message..."}
          className="border rounded-lg px-3 py-1.5 text-xs flex-1 bg-white focus:outline-none focus:border-[var(--navy)]"
        />
        <button
          disabled={!text.trim()}
          className="bg-[var(--navy)] text-white font-semibold px-3 py-1.5 rounded-lg text-xs disabled:opacity-50 hover:opacity-90"
        >
          {t("send") || "Send"}
        </button>
      </form>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
