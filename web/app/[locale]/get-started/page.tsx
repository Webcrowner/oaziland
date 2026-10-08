"use client";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import {
  IconSearch,
  IconBuilding,
  IconBriefcase,
  IconGraduationCap,
  IconCar,
  IconWrench,
} from "@/components/Icons";

/**
 * The real "what do you want to do here" step — shown once, right
 * after a brand-new account's first login (wired from register/login
 * pages via sessionStorage's "oaziland_just_registered" flag), not a
 * dismiss-forever modal shown to every visitor. Each choice routes to
 * a genuinely existing, already-working page for that role — never a
 * placeholder destination.
 */
const PERSONAS = [
  { key: "renter", icon: IconSearch, destination: "/search" },
  { key: "landlord", icon: IconBuilding, destination: "/list-property" },
  { key: "agent", icon: IconBriefcase, destination: "/how-it-works" },
  { key: "student", icon: IconGraduationCap, destination: "/student-hostels" },
  { key: "driver", icon: IconCar, destination: "/oazigo" },
  { key: "technician", icon: IconWrench, destination: "/taskln-service" },
] as const;

export default function GetStartedPage() {
  const t = useTranslations("GetStartedPage");
  const router = useRouter();

  return (
    <main className="max-w-3xl mx-auto px-4 py-16">
      <div className="text-center mb-10">
        <h1 className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-bold text-[var(--navy)] mb-2">
          {t("title")}
        </h1>
        <p className="text-sm text-gray-500">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {PERSONAS.map((persona, index) => {
          const Icon = persona.icon;
          return (
            <button
              key={persona.key}
              onClick={() => router.push(persona.destination)}
              className={`text-left border rounded-2xl p-5 transition-all duration-200 hover:border-[var(--gold)] hover:shadow-md hover:-translate-y-0.5 bg-white ${
                index === 0 ? "sm:col-span-2 border-[var(--gold)]/60 bg-amber-50/40" : "border-gray-200"
              }`}
            >
              <div className="w-10 h-10 rounded-xl bg-[var(--navy)]/5 text-[var(--navy)] flex items-center justify-center mb-3">
                <Icon size={20} />
              </div>
              <p className="font-semibold text-[var(--navy)] text-sm mb-1">{t(persona.key)}</p>
              <p className="text-xs text-gray-500">{t(`${persona.key}Desc`)}</p>
            </button>
          );
        })}
      </div>

      <div className="text-center">
        <Link href="/" className="text-sm text-gray-400 hover:text-gray-600 underline">
          {t("skip")}
        </Link>
      </div>
    </main>
  );
}
