"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

type Persona = "renter" | "landlord" | "agent" | "student";

/**
 * The guided tour / "how to use the platform" page. Every step here
 * describes a REAL, already-built feature (search filters, lister-
 * role visibility, WhatsApp contact, MFA, listing expiry/renewal,
 * boosts, agent dashboard, the wanted board, training, hostel
 * installments, referrals) — nothing invented, so following the
 * tour actually works.
 */
export default function GuidedTourPage() {
  const t = useTranslations("GuidedTourPage");
  const [persona, setPersona] = useState<Persona>("renter");

  const tabs: { key: Persona; labelKey: string }[] = [
    { key: "renter", labelKey: "tabRenter" },
    { key: "landlord", labelKey: "tabLandlord" },
    { key: "agent", labelKey: "tabAgent" },
    { key: "student", labelKey: "tabStudent" },
  ];

  const stepsByPersona: Record<Persona, { titleKey: string; textKey: string }[]> = {
    renter: [
      { titleKey: "renterStep1Title", textKey: "renterStep1Text" },
      { titleKey: "renterStep2Title", textKey: "renterStep2Text" },
      { titleKey: "renterStep3Title", textKey: "renterStep3Text" },
      { titleKey: "renterStep4Title", textKey: "renterStep4Text" },
    ],
    landlord: [
      { titleKey: "landlordStep1Title", textKey: "landlordStep1Text" },
      { titleKey: "landlordStep2Title", textKey: "landlordStep2Text" },
      { titleKey: "landlordStep3Title", textKey: "landlordStep3Text" },
      { titleKey: "landlordStep4Title", textKey: "landlordStep4Text" },
    ],
    agent: [
      { titleKey: "agentStep1Title", textKey: "agentStep1Text" },
      { titleKey: "agentStep2Title", textKey: "agentStep2Text" },
      { titleKey: "agentStep3Title", textKey: "agentStep3Text" },
      { titleKey: "agentStep4Title", textKey: "agentStep4Text" },
    ],
    student: [
      { titleKey: "studentStep1Title", textKey: "studentStep1Text" },
      { titleKey: "studentStep2Title", textKey: "studentStep2Text" },
      { titleKey: "studentStep3Title", textKey: "studentStep3Text" },
      { titleKey: "studentStep4Title", textKey: "studentStep4Text" },
    ],
  };

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="font-[family-name:var(--font-display)] text-2xl text-[var(--navy)] mb-1">{t("title")}</h1>
      <p className="text-gray-600 mb-6">{t("subtitle")}</p>

      <div className="flex flex-wrap gap-2 mb-8 border-b pb-4">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setPersona(tab.key)}
            className={`px-4 py-2 rounded text-sm font-semibold transition-colors ${
              persona === tab.key ? "bg-[var(--navy)] text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-6">
        {stepsByPersona[persona].map((step, index) => (
          <div key={step.titleKey} className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-[var(--gold)] text-[var(--navy)] font-bold flex items-center justify-center flex-shrink-0">
              {index + 1}
            </div>
            <div>
              <h2 className="font-semibold text-[var(--navy)] mb-1">{t(step.titleKey)}</h2>
              <p className="text-gray-600 text-sm">{t(step.textKey)}</p>
            </div>
          </div>
        ))}
      </div>

      {persona === "student" && (
        <Link href="/referrals" className="inline-block mt-8 bg-[var(--gold)] text-[var(--navy)] font-semibold px-6 py-3 rounded hover:opacity-90">
          {t("referralCta")}
        </Link>
      )}
    </main>
  );
}
