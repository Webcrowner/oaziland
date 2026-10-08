"use client";
import { useState } from "react";
import { suggestMissingArea, type Quarter } from "@/lib/api";

/**
 * "Can't find your area?" — listers can't type an area onto a listing, so this
 * sends admins a request instead. Meanwhile they pick the nearest listed area.
 */
export default function MissingAreaRequest({ quarters, className = "" }: { quarters: Quarter[]; className?: string }) {
  const regions = [...new Set(quarters.map((q) => q.region_name).filter((r): r is string => !!r))].sort();
  const [open, setOpen] = useState(false);
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");
  const [area, setArea] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  async function send() {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setError("Please sign in to request a new area.");
      return;
    }
    setStatus("sending");
    setError("");
    try {
      await suggestMissingArea({ region_name: region, city_name: city.trim(), area_name: area.trim() }, token);
      setStatus("sent");
    } catch (err) {
      setStatus("idle");
      setError(err instanceof Error ? err.message : "Could not send your request");
    }
  }

  if (status === "sent") {
    return (
      <p className={`text-xs text-emerald-700 font-medium ${className}`}>
        Thanks — we&apos;ll review &ldquo;{area}&rdquo; and add it. Until then, choose the nearest listed area and
        pin the exact spot with GPS.
      </p>
    );
  }

  return (
    <div className={className}>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-amber-700 underline">
          Can&apos;t find your area? Request it
        </button>
      ) : (
        <div className="border border-amber-200 bg-amber-50/60 rounded-xl p-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <select value={region} onChange={(e) => setRegion(e.target.value)} className="border rounded-lg px-2.5 py-2 text-xs bg-white">
            <option value="">Region…</option>
            {regions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City / town" maxLength={100} className="border rounded-lg px-2.5 py-2 text-xs bg-white" />
          <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Neighborhood name" maxLength={100} className="border rounded-lg px-2.5 py-2 text-xs bg-white" />
          <div className="sm:col-span-3 flex items-center gap-3">
            <button
              type="button"
              disabled={status === "sending" || !region || !city.trim() || !area.trim()}
              onClick={send}
              className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold disabled:opacity-50"
            >
              {status === "sending" ? "Sending…" : "Send request"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 underline">Cancel</button>
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
          <p className="sm:col-span-3 text-[11px] text-slate-500">
            New areas are reviewed before they appear. Meanwhile, pick the nearest listed area and pin the exact spot with GPS.
          </p>
        </div>
      )}
    </div>
  );
}
