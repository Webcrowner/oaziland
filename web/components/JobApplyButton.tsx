"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { applyToJob } from "@/lib/api";

/**
 * A small, self-contained client island for the one real interactive
 * part of an otherwise server-rendered job listing — kept separate
 * so the Careers page itself stays server-rendered, the same pattern
 * as FavoriteButton/ContactListingButton elsewhere in this app.
 */
export default function JobApplyButton({ jobId, applyLabel }: { jobId: string; applyLabel: string }) {
  const t = useTranslations("CareersPage");
  const router = useRouter();
  const [coverMessage, setCoverMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "applied" | "error">("idle");
  const [errorText, setErrorText] = useState("");

  async function handleApply() {
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    setStatus("submitting");
    try {
      await applyToJob(jobId, coverMessage, token);
      setStatus("applied");
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : t("applyFailed"));
      setStatus("error");
    }
  }

  if (status === "applied") {
    return <p className="text-green-700 text-sm font-semibold">✓ {t("applied")}</p>;
  }

  if (!showForm) {
    return (
      <button onClick={() => setShowForm(true)} className="bg-[var(--gold)] text-[var(--navy)] font-semibold px-4 py-2 rounded-lg text-sm hover:brightness-105">
        {applyLabel}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        rows={3} placeholder={t("coverMessagePlaceholder")} value={coverMessage}
        onChange={(e) => setCoverMessage(e.target.value)} className="border rounded px-3 py-2 text-sm"
      />
      {status === "error" && <p className="text-red-600 text-xs">{errorText}</p>}
      <button
        onClick={handleApply} disabled={status === "submitting"}
        className="bg-[var(--gold)] text-[var(--navy)] font-semibold px-4 py-2 rounded-lg text-sm hover:brightness-105 disabled:opacity-50 self-start"
      >
        {status === "submitting" ? t("submitting") : t("submitApplication")}
      </button>
    </div>
  );
}
