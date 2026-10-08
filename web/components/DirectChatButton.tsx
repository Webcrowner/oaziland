"use client";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { getOrCreateConversation } from "@/lib/api";

interface DirectChatButtonProps {
  recipientId: string;
  recipientName?: string;
  className?: string;
  label?: string;
}

export default function DirectChatButton({
  recipientId,
  recipientName,
  className = "",
  label,
}: DirectChatButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleClick() {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (!token) {
      router.push("/login");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const conv = await getOrCreateConversation(recipientId, token);
      router.push(`/messages?conversation=${conv.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open conversation");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={loading}
        className={
          className ||
          "inline-flex items-center gap-2 bg-[var(--navy)] text-white font-semibold px-4 py-2.5 rounded-xl hover:bg-slate-800 disabled:opacity-50 transition-colors text-sm"
        }
      >
        <span>💬</span>
        <span>{loading ? "Opening..." : label || `Chat with ${recipientName || "User"}`}</span>
      </button>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
