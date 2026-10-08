"use client";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { joinListingWaitlist } from "@/lib/api";

/**
 * Prompt 15's "NEW — Waitlist": lets a user opt in to be notified the
 * moment this listing becomes available again — join_listing_waitlist()
 * was fully built and tested, but no page ever let a real user reach it.
 */
export default function JoinWaitlistButton({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "joining" | "joined" | "error">("idle");

  async function handleJoin() {
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    setStatus("joining");
    try {
      await joinListingWaitlist(listingId, token);
      setStatus("joined");
    } catch {
      setStatus("error");
    }
  }

  if (status === "joined") {
    return <p className="text-xs font-semibold text-emerald-700 text-center">✓ You'll be notified if this listing becomes available.</p>;
  }

  return (
    <button
      onClick={handleJoin}
      disabled={status === "joining"}
      className="w-full border border-[var(--navy)] text-[var(--navy)] font-semibold py-2.5 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
    >
      {status === "joining" ? "Joining..." : "Notify Me If This Becomes Available"}
    </button>
  );
}
