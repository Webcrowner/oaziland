"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

const SEEN_KEY = "oaziland_onboarding_seen";

/**
 * A real first-visit onboarding flow — shown once per browser (tracked
 * via localStorage, not a cookie/account flag, since this is about
 * orienting a NEW VISITOR, logged in or not). Presents the platform's
 * four real personas as a plain selection grid, not a numbered
 * sequence — choosing "who am I" isn't a step-by-step process, so no
 * 01/02/03 markers here, unlike the guided tour's own actual steps.
 * Each choice routes to a genuinely relevant, already-built starting
 * point — never a placeholder destination.
 */
export default function OnboardingModal() {
  const t = useTranslations("OnboardingModal");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(SEEN_KEY)) {
      setOpen(true);
    }
  }, []);

  function choose(destination: string) {
    localStorage.setItem(SEEN_KEY, "1");
    setOpen(false);
    router.push(destination);
  }

  function dismiss() {
    localStorage.setItem(SEEN_KEY, "1");
    setOpen(false);
  }

  if (!open) return null;

  const personas = [
    { key: "renter", destination: "/search" },
    { key: "landlord", destination: "/list-property" },
    { key: "agent", destination: "/how-it-works" },
    { key: "student", destination: "/student-hostels" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--navy)]/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 md:p-8 shadow-2xl animate-rise-in">
        <h2 className="font-[family-name:var(--font-display)] text-2xl text-[var(--navy)] mb-1">{t("title")}</h2>
        <p className="text-gray-500 mb-6">{t("subtitle")}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {personas.map((persona) => (
            <button
              key={persona.key}
              onClick={() => choose(persona.destination)}
              className="text-left border border-gray-200 rounded-xl p-4 transition-all duration-200 hover:border-[var(--gold)] hover:shadow-md hover:-translate-y-0.5"
            >
              <p className="font-semibold text-[var(--navy)] text-sm mb-1">{t(persona.key)}</p>
              <p className="text-xs text-gray-500">{t(`${persona.key}Desc`)}</p>
            </button>
          ))}
        </div>

        <button onClick={dismiss} className="text-sm text-gray-400 hover:text-gray-600 underline">
          {t("skip")}
        </button>
      </div>
    </div>
  );
}
