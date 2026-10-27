"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

const SEEN_KEY = "oaziland_onboarding_seen";

export default function WelcomeChoices() {
  const t = useTranslations("OnboardingModal");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(SEEN_KEY)) {
      void Promise.resolve().then(() => setOpen(true));
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
    <section aria-labelledby="welcome-title" className="px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-6 md:p-8">
        <h2 id="welcome-title" className="font-[family-name:var(--font-display)] text-2xl text-[var(--navy)] mb-1">{t("title")}</h2>
        <p className="text-gray-500 mb-6">{t("subtitle")}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
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

        <button onClick={dismiss} className="min-h-11 text-sm text-slate-600 hover:text-slate-900 underline">
          {t("skip")}
        </button>
      </div>
    </section>
  );
}
