"use client";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cardCls } from "./styles";

const RIDER_STEPS = [1, 2, 3, 4, 5] as const;
const DRIVER_STEPS = [1, 2, 3, 4, 5] as const;

function Steps({ prefix, steps }: { prefix: "rider" | "driver"; steps: readonly number[] }) {
  const t = useTranslations("OaziGoPage");
  return (
    <ol className="flex flex-col gap-4">
      {steps.map((n) => (
        <li key={n} className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-xs font-black text-amber-900">{n}</span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-slate-900">{t(`how_${prefix}_${n}_title`)}</span>
            <span className="mt-1 block text-sm leading-relaxed text-slate-600">{t(`how_${prefix}_${n}_desc`)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function HowItWorks() {
  const t = useTranslations("OaziGoPage");
  return (
    <section aria-labelledby="oazigo-how" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="oazigo-how" className="text-xl font-black tracking-tight text-slate-900">{t("howTitle")}</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className={`${cardCls} flex flex-col justify-between border-slate-200/90`}>
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">
              {t("transportPassenger")}
            </div>
            <h3 className="mb-5 text-lg font-black tracking-tight text-slate-900">{t("howRidersTitle")}</h3>
            <Steps prefix="rider" steps={RIDER_STEPS} />
          </div>
          <Link href="/oazigo/request" className="mt-6 inline-flex w-fit items-center justify-center rounded-xl bg-amber-400 px-5 py-2.5 text-xs font-bold text-slate-950 shadow-sm hover:bg-amber-300 transition-colors">
            {t("requestRideTitle")}
          </Link>
        </div>
        <div className={`${cardCls} flex flex-col justify-between border-slate-200/90`}>
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-amber-300">
              {t("navDrive")}
            </div>
            <h3 className="mb-5 text-lg font-black tracking-tight text-slate-900">{t("howDriversTitle")}</h3>
            <Steps prefix="driver" steps={DRIVER_STEPS} />
          </div>
          <Link href="/oazigo/drive" className="mt-6 inline-flex w-fit items-center justify-center rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-slate-800 transition-colors">
            {t("registerAsDriver")}
          </Link>
        </div>
      </div>
    </section>
  );
}
