"use client";
import { useCallback, useEffect, useState } from "react";
import { listDisputeMessages, sendDisputeMessage, type DisputeMessageItem } from "@/lib/api";

const POLL_MS = 6000;

/** Private 3-way dispute mediation chat between complainant, respondent, and dispute officer. */
export default function DisputeChat({
  disputeId,
  myUserId,
}: {
  disputeId: string;
  myUserId: string | null;
}) {
  const [messages, setMessages] = useState<DisputeMessageItem[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    listDisputeMessages(disputeId, token)
      .then(setMessages)
      .catch(() => {});
  }, [disputeId]);

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
      await sendDisputeMessage(disputeId, text.trim(), token);
      setText("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send mediation message");
    }
  }

  return (
    <div className="border border-amber-200 rounded-xl p-3 bg-amber-50/50 mt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
          ⚖️ Dispute Mediation Room (3-Way Chat)
        </span>
        <span className="text-[10px] text-amber-700 font-semibold bg-amber-100 px-2 py-0.5 rounded-full">
          Admin Mediated
        </span>
      </div>

      <div className="max-h-48 overflow-y-auto flex flex-col gap-1.5 mb-2 p-1">
        {messages.length === 0 && (
          <p className="text-xs text-amber-800/70 italic py-1">
            No mediation messages yet. Complainant, provider, or mediator can post evidence or statements here.
          </p>
        )}
        {messages.map((m) => {
          const isMe = m.sender === myUserId;
          return (
            <div
              key={m.id}
              className={`text-xs max-w-[85%] px-3 py-1.5 rounded-xl ${
                isMe
                  ? "self-end bg-[var(--navy)] text-white"
                  : "self-start bg-white border border-amber-200/80 text-gray-800 shadow-2xs"
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
          placeholder="State your claim, evidence, or question..."
          className="border border-amber-200 rounded-lg px-3 py-1.5 text-xs flex-1 bg-white focus:outline-none focus:border-amber-500"
        />
        <button
          disabled={!text.trim()}
          className="bg-amber-600 hover:bg-amber-700 text-white font-semibold px-3 py-1.5 rounded-lg text-xs disabled:opacity-50 transition-colors"
        >
          Send
        </button>
      </form>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
