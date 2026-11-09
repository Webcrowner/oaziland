"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { fileContentReport, type ReportKind } from "@/lib/api";
import HideForOwner from "@/components/HideForOwner";

const REASONS = ["SCAM_SUSPECTED", "MISLEADING_LISTING", "INAPPROPRIATE_CONTENT", "HARASSMENT", "OTHER"] as const;

interface Props {
  kind: ReportKind;
  id: string;
  /** Hides the button from the person who posted the item. */
  ownerId?: string;
  /** "inline" is a small link for use inside comments and reviews. */
  variant?: "default" | "inline";
}

/** Lets a signed-in visitor flag a listing, place, comment, review or job posting for admin review. */
export default function ReportContentButton({ kind, id, ownerId, variant = "default" }: Props) {
  const t = useTranslations("ReportContent");
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "form" | "done">("idle");
  const [reason, setReason] = useState<string>(kind === "comment" || kind.endsWith("review") ? "HARASSMENT" : "SCAM_SUSPECTED");
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
      await fileContentReport(kind, id, reason, notes.trim(), token);
      setMode("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  let body: React.ReactNode;
  if (mode === "done") {
    body = <p role="status" className="text-xs text-green-700">✓ {t("submitted")}</p>;
  } else if (mode === "form") {
    const title = t(`title_${kind}`);
    body = (
      <form onSubmit={submit} className="border border-gray-200 rounded-lg p-3 flex flex-col gap-2 bg-white text-left w-full">
        <p className="text-sm font-semibold text-[var(--navy)]">{title}</p>
        <select value={reason} onChange={(e) => setReason(e.target.value)} className="border rounded px-2 py-1.5 text-sm" aria-label={t("reasonLabel")}>
          {REASONS.map((r) => <option key={r} value={r}>{t(`reason_${r}`)}</option>)}
        </select>
        <textarea
          rows={2} maxLength={1000} placeholder={t("notesPlaceholder")} aria-label={t("notesPlaceholder")}
          value={notes} onChange={(e) => setNotes(e.target.value)} className="border rounded px-2 py-1.5 text-sm"
        />
        {error && <p role="alert" className="text-red-600 text-xs">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="bg-[var(--clay)] text-white text-xs font-semibold px-3 py-1.5 rounded disabled:opacity-50 cursor-pointer">
            {busy ? t("sending") : t("submit")}
          </button>
          <button type="button" onClick={() => setMode("idle")} className="text-xs text-gray-500 underline cursor-pointer">{t("cancel")}</button>
        </div>
      </form>
    );
  } else {
    body = (
      <button
        type="button"
        onClick={open}
        className={
          variant === "inline"
            ? "text-[11px] text-gray-400 hover:text-[var(--clay)] hover:underline cursor-pointer shrink-0"
            : "text-xs text-gray-400 underline hover:text-[var(--clay)] cursor-pointer self-start"
        }
      >
        {variant === "inline" ? t("reportShort") : t(`report_${kind}`)}
      </button>
    );
  }

  return ownerId ? <HideForOwner ownerId={ownerId}>{body}</HideForOwner> : <>{body}</>;
}
