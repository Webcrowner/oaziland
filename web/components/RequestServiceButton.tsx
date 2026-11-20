"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { requestPartnerService, PARTNER_SERVICE_REQUESTED_EVENT } from "@/lib/api";

/**
 * The real gap this closes: request_partner_service() was fully built
 * and tested, but the Partner Services directory was browse-only.
 */
export default function RequestServiceButton({ offeringId }: { offeringId: number }) {
  const t = useTranslations("ServicesPage");
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "open" | "submitting" | "requested" | "error">("idle");
  const [notes, setNotes] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit() {
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    setStatus("submitting");
    setErrorMessage("");
    try {
      await requestPartnerService(offeringId, notes, token);
      setStatus("requested");
      window.dispatchEvent(new Event(PARTNER_SERVICE_REQUESTED_EVENT));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "");
      setStatus("error");
    }
  }

  if (status === "requested") {
    return <p role="status" className="text-xs font-bold text-emerald-700 mt-2">✓ {t("requestSent")}</p>;
  }

  if (status === "idle") {
    return (
      <div className="mt-2">
        <button onClick={() => setStatus("open")} className="text-xs font-bold text-[var(--navy)] underline">
          {t("requestThisService")}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <textarea
        rows={2} placeholder={t("notesPlaceholder")} aria-label={t("notesPlaceholder")} value={notes} onChange={(e) => setNotes(e.target.value)}
        className="border rounded-lg px-2 py-1 text-xs"
      />
      <button
        onClick={handleSubmit}
        disabled={status === "submitting"}
        className="text-xs font-bold bg-[var(--navy)] text-white rounded-lg px-3 py-1.5 disabled:opacity-50 self-start"
      >
        {status === "submitting" ? t("sending") : t("confirmRequest")}
      </button>
      {status === "error" && <p role="alert" className="text-[11px] text-red-600">{errorMessage || t("requestFailed")}</p>}
    </div>
  );
}
