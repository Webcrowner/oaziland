"use client";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { requestPartnerService } from "@/lib/api";

/**
 * The real gap this closes: request_partner_service() was fully built
 * and tested, but the Partner Services directory was browse-only.
 */
export default function RequestServiceButton({ offeringId }: { offeringId: number }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "open" | "submitting" | "requested" | "error">("idle");
  const [notes, setNotes] = useState("");

  async function handleSubmit() {
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    setStatus("submitting");
    try {
      await requestPartnerService(offeringId, notes, token);
      setStatus("requested");
    } catch {
      setStatus("error");
    }
  }

  if (status === "requested") {
    return <p className="text-xs font-bold text-emerald-700 mt-2">✓ Request sent</p>;
  }

  if (status === "idle" || status === "error") {
    return (
      <div className="mt-2">
        <button onClick={() => setStatus("open")} className="text-xs font-bold text-[var(--navy)] underline">
          Request This Service
        </button>
        {status === "error" && <p className="text-[10px] text-red-600 mt-1">Could not send request.</p>}
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <textarea
        rows={2} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)}
        className="border rounded-lg px-2 py-1 text-xs"
      />
      <button
        onClick={handleSubmit}
        disabled={status === "submitting"}
        className="text-xs font-bold bg-[var(--navy)] text-white rounded-lg px-3 py-1.5 disabled:opacity-50 self-start"
      >
        {status === "submitting" ? "Sending..." : "Confirm Request"}
      </button>
    </div>
  );
}
