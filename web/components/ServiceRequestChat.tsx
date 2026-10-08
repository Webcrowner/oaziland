"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { listServiceRequestMessages, sendServiceRequestMessage, type ServiceRequestMessageItem } from "@/lib/api";

const POLL_MS = 10000;

/** Private chat between a job's requester and its assigned technician. */
export default function ServiceRequestChat({ requestId, myUserId }: { requestId: string; myUserId: string | null }) {
  const t = useTranslations("TasklnServicePage");
  const [messages, setMessages] = useState<ServiceRequestMessageItem[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    listServiceRequestMessages(requestId, token).then(setMessages).catch(() => {});
  }, [requestId]);

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
      await sendServiceRequestMessage(requestId, text.trim(), token);
      setText("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sendMessageFailed"));
    }
  }

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
      <div className="max-h-48 overflow-y-auto flex flex-col gap-1.5 mb-2">
        {messages.length === 0 && <p className="text-xs text-gray-400">{t("noMessages")}</p>}
        {messages.map((m) => (
          <div key={m.id} className={`text-xs max-w-[85%] px-2.5 py-1.5 rounded-lg ${m.sender === myUserId ? "self-end bg-[var(--navy)] text-white" : "self-start bg-white border border-gray-200 text-gray-800"}`}>
            {m.sender !== myUserId && <p className="font-semibold text-[10px] opacity-70">{m.sender_name}</p>}
            <p>{m.text}</p>
          </div>
        ))}
      </div>
      <form onSubmit={handleSend} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder={t("typeMessage")} className="border rounded px-3 py-1.5 text-sm flex-1" />
        <button disabled={!text.trim()} className="bg-[var(--navy)] text-white font-semibold px-3 py-1.5 rounded text-sm disabled:opacity-50">{t("send")}</button>
      </form>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
