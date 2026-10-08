"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { submitContactMessage } from "@/lib/api";
import Button from "@/components/ui/Button";

interface InterestCaptureModalProps {
  itemName: string;
  variant?: "notify" | "booking";
  onClose: () => void;
}

// Real customer-facing lead capture for showcase/preview cards — these
// items aren't live bookable listings yet, so instead of a misleading
// "Book Now" on fake data, this collects a genuine interest signal via
// the same real, persisted /api/contact/ endpoint the Contact page uses.
export default function InterestCaptureModal({ itemName, variant = "notify", onClose }: InterestCaptureModalProps) {
  const t = useTranslations("InterestCapture");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    try {
      await submitContactMessage({
        name,
        email,
        message:
          variant === "booking"
            ? `Booking request: I'd like to book a stay like "${itemName}". Please contact me with availability.`
            : `I'm interested in a listing like "${itemName}". Please notify me when a similar verified listing becomes available.`,
      });
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {status === "success" ? (
          <div className="text-center py-4">
            <p className="font-bold text-slate-900 mb-1.5">{t("thanksTitle")}</p>
            <p className="text-xs text-slate-500 mb-5">{t(variant === "booking" ? "bookingThanksBody" : "thanksBody")}</p>
            <Button onClick={onClose} className="w-full">
              {t("close")}
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h3 className="font-bold text-slate-900 text-lg mb-1">{t(variant === "booking" ? "bookingTitle" : "title")}</h3>
            <p className="text-xs text-slate-500 mb-4">{t(variant === "booking" ? "bookingSubtitle" : "subtitle", { name: itemName })}</p>
            <div className="flex flex-col gap-3">
              <input
                required
                placeholder={t("namePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
              <input
                required
                type="email"
                placeholder={t("emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
              {status === "error" && <p className="text-red-600 text-xs">{t("failed")}</p>}
              <div className="flex gap-2 pt-1">
                <Button disabled={status === "submitting"} className="flex-1">
                  {status === "submitting" ? t("submitting") : t(variant === "booking" ? "bookingSubmit" : "submit")}
                </Button>
                <button type="button" onClick={onClose} className="px-4 text-sm text-slate-500">
                  {t("cancel")}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
