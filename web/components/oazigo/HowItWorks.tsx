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
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-black text-white">{n}</span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-slate-900">{t(`how_${prefix}_${n}_title`)}</span>
            <span className="mt-0.5 block text-sm text-slate-500">{t(`how_${prefix}_${n}_desc`)}</span>
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
      <h2 id="oazigo-how" className="text-xl font-black tracking-tight text-slate-900">{t("howTitle")}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className={cardCls}>
          <h3 className="mb-4 text-base font-black tracking-tight text-slate-900">{t("howRidersTitle")}</h3>
          <Steps prefix="rider" steps={RIDER_STEPS} />
          <Link href="/oazigo/request" className="mt-5 inline-block rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 transition-colors">
            {t("requestRideTitle")}
          </Link>
        </div>
        <div className={cardCls}>
          <h3 className="mb-4 text-base font-black tracking-tight text-slate-900">{t("howDriversTitle")}</h3>
          <Steps prefix="driver" steps={DRIVER_STEPS} />
          <Link href="/oazigo/drive" className="mt-5 inline-block rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition-colors">
            {t("registerAsDriver")}
          </Link>
        </div>
      </div>
    </section>
  );
}
