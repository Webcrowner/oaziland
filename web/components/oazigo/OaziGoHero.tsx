"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { IconCar, IconChevronRight, IconMapPin } from "@/components/Icons";
import { RIDE_CATEGORIES } from "./styles";

export default function OaziGoHero({ signedOut = false }: { signedOut?: boolean }) {
  const t = useTranslations("OaziGoPage");
  const common = useTranslations("MobileNav");

  return (
    <section className="relative overflow-hidden rounded-[2rem] bg-slate-950 text-white shadow-xl shadow-slate-900/10">
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-32 h-80 w-80 rounded-full bg-amber-400/20 blur-3xl" />
      <div className="relative grid gap-8 p-6 sm:p-10 md:grid-cols-[1.3fr_0.7fr] md:items-center">
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 text-xs font-bold tracking-wide text-amber-300">
            <IconCar size={16} />
            OaziGo
          </div>
          <h1 className="text-4xl font-black tracking-tight sm:text-5xl">{t("title")}</h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">{t("subtitle")}</p>
          {signedOut && <p className="mt-4 text-sm font-medium text-amber-200">{t("signInRequired")}</p>}
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href={signedOut ? "/login" : "/oazigo/request"} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-400 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300">
              {signedOut ? common("signIn") : t("navRequest")}
              <IconChevronRight size={16} />
            </Link>
            <Link href="/oazigo/cars" className="inline-flex min-h-11 items-center rounded-xl border border-white/25 px-5 py-3 text-sm font-bold text-white transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              {t("navCars")}
            </Link>
          </div>
        </div>
        <div className="rounded-3xl border border-white/15 bg-white/[0.06] p-5 backdrop-blur-sm sm:p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-400 text-slate-950 shadow-md shadow-amber-400/20">
              <IconMapPin size={20} />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-amber-300">{t("vehicleCategoryLabel")}</p>
              <p className="mt-0.5 text-sm text-slate-300">{t("transportPassenger")} · {t("transportCargo")}</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-1">
            {RIDE_CATEGORIES.map((cat) => (
              <div key={cat} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-2">
                <span className="text-xs font-bold text-white">{t(`category_${cat}`)}</span>
                <span className="truncate text-[11px] text-slate-300">{t(`categoryHint_${cat}`)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
