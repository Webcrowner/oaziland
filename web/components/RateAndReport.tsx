"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { rateUser, fileReportAgainstUser } from "@/lib/api";

const REPORT_REASONS = ["SCAM_SUSPECTED", "HARASSMENT", "MISLEADING_LISTING", "USER_BEHAVIOR", "OTHER"] as const;

/**
 * A real gap this closes: agent/agency profiles already showed an
 * aggregated star rating, but nothing ever let a real visitor
 * contribute one — and there was no way to report a person directly
 * at all, only content they'd posted. One shared component for both
 * the agent profile page and the listing detail lister card, since
 * the real action (rate or report THIS person) is identical in both
 * places.
 */
export default function RateAndReport({ subjectUserId }: { subjectUserId: string }) {
  const t = useTranslations("RateAndReport");
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "rating" | "reporting" | "rated" | "reported">("idle");
  const [hoveredStar, setHoveredStar] = useState(0);
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  function requireAuth(): string | null {
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return null;
    }
    return token;
  }

  async function handleRate(score: number) {
    const token = requireAuth();
    if (!token) return;
    try {
      await rateUser(subjectUserId, score, token);
      setMode("rated");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("genericError"));
    }
  }

  async function handleReport(e: React.FormEvent) {
    e.preventDefault();
    const token = requireAuth();
    if (!token) return;
    try {
      await fileReportAgainstUser(subjectUserId, reason, notes, token);
      setMode("reported");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("genericError"));
    }
  }

  if (mode === "rated") return <p className="text-sm text-green-700">✓ {t("thanksForRating")}</p>;
  if (mode === "reported") return <p className="text-sm text-green-700">✓ {t("reportSubmitted")}</p>;

  if (mode === "reporting") {
    return (
      <form onSubmit={handleReport} className="border border-gray-200 rounded-lg p-4 flex flex-col gap-2 bg-white">
        <p className="text-sm font-semibold text-[var(--navy)]">{t("reportTitle")}</p>
        <select value={reason} onChange={(e) => setReason(e.target.value)} className="border rounded px-2 py-1.5 text-sm">
          {REPORT_REASONS.map((r) => <option key={r} value={r}>{t(`reason_${r}`)}</option>)}
        </select>
        <textarea
          rows={2} placeholder={t("notesPlaceholder")} value={notes} onChange={(e) => setNotes(e.target.value)}
          className="border rounded px-2 py-1.5 text-sm"
        />
        {error && <p className="text-red-600 text-xs">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" className="bg-[var(--clay)] text-white text-xs font-semibold px-3 py-1.5 rounded">{t("submitReport")}</button>
          <button type="button" onClick={() => setMode("idle")} className="text-xs text-gray-500 underline">{t("cancel")}</button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-1" onMouseLeave={() => setHoveredStar(0)}>
        <span className="text-xs text-gray-500 mr-1">{t("rateThisPerson")}:</span>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star} onMouseEnter={() => setHoveredStar(star)} onClick={() => handleRate(star)}
            className={`text-lg leading-none transition-colors ${star <= hoveredStar ? "text-[var(--gold)]" : "text-gray-300"}`}
            aria-label={`${star} stars`}
          >
            ★
          </button>
        ))}
      </div>
      <button onClick={() => setMode("reporting")} className="text-xs text-gray-400 underline hover:text-[var(--clay)]">
        {t("report")}
      </button>
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </div>
  );
}
