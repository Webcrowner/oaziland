"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { fileReportAgainstListing } from "@/lib/api";

const REPORT_REASONS = ["SCAM_SUSPECTED", "MISLEADING_LISTING", "INAPPROPRIATE_CONTENT", "OTHER"] as const;

/** Lets a signed-in visitor flag a marketplace listing for admin review. */
export default function ReportListingButton({ listingId }: { listingId: string }) {
  const t = useTranslations("ReportListing");
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "form" | "done">("idle");
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function open() {
    if (!localStorage.getItem("access_token")) {
      router.push("/login");
      return;
    }
    setMode("form");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      await fileReportAgainstListing(listingId, reason, notes, token);
      setMode("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  if (mode === "done") return <p className="text-sm text-green-700">✓ {t("submitted")}</p>;

  if (mode === "form") {
    return (
      <form onSubmit={submit} className="border border-gray-200 rounded-lg p-4 flex flex-col gap-2 bg-white">
        <p className="text-sm font-semibold text-[var(--navy)]">{t("title")}</p>
        <select value={reason} onChange={(e) => setReason(e.target.value)} className="border rounded px-2 py-1.5 text-sm" aria-label={t("title")}>
          {REPORT_REASONS.map((r) => <option key={r} value={r}>{t(`reason_${r}`)}</option>)}
        </select>
        <textarea rows={2} placeholder={t("notesPlaceholder")} value={notes} onChange={(e) => setNotes(e.target.value)} className="border rounded px-2 py-1.5 text-sm" />
        {error && <p className="text-red-600 text-xs">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="bg-[var(--clay)] text-white text-xs font-semibold px-3 py-1.5 rounded disabled:opacity-50 cursor-pointer">
            {busy ? t("sending") : t("submit")}
          </button>
          <button type="button" onClick={() => setMode("idle")} className="text-xs text-gray-500 underline cursor-pointer">{t("cancel")}</button>
        </div>
      </form>
    );
  }

  return (
    <button onClick={open} className="text-xs text-gray-400 underline hover:text-[var(--clay)] cursor-pointer self-start">
      {t("report")}
    </button>
  );
}
