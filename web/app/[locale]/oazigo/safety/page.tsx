"use client";
import { useTranslations } from "next-intl";
import EmergencyContactCard from "@/components/EmergencyContactCard";
import Button from "@/components/ui/Button";
import { IconShieldCheck, IconAlertCircle, IconCheckCircle } from "@/components/Icons";
import { useOaziGo } from "@/components/oazigo/OaziGoProvider";
import { cardCls } from "@/components/oazigo/styles";

const SOS_STEPS = ["safetySos1", "safetySos2", "safetySos3"] as const;
const TIPS = ["safetyTip1", "safetyTip2", "safetyTip3", "safetyTip4", "safetyTip5"] as const;

export default function OaziGoSafetyPage() {
  const t = useTranslations("OaziGoPage");
  const { myRides } = useOaziGo();
  // SOS is only accepted on accepted or in-progress trips, so a merely requested ride doesn't count here.
  const tripUnderway = myRides.some((r) => r.status === "ACCEPTED" || r.status === "IN_PROGRESS");

  return (
    <div className="flex flex-col gap-5">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white shadow-xl shadow-slate-900/10">
        <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-emerald-400/15 blur-3xl" />
        <div className="relative flex items-center gap-5 p-6 sm:p-8">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/25">
            <IconShieldCheck size={28} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-black tracking-tight">{t("safetyTitle")}</h1>
            <p className="mt-1 text-sm text-slate-400">{t("safetySubtitle")}</p>
          </div>
        </div>
      </section>

      {tripUnderway && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-red-200 bg-red-50 p-5">
          <div className="flex min-w-0 items-start gap-3">
            <IconAlertCircle size={20} className="mt-0.5 shrink-0 text-red-600" />
            <div className="min-w-0">
              <p className="text-sm font-black text-red-900">{t("safetyActiveTripTitle")}</p>
              <p className="mt-0.5 text-sm text-red-800">{t("safetyActiveTripBody")}</p>
            </div>
          </div>
          <Button variant="dark" href="/oazigo/trips">{t("safetyOpenTrip")}</Button>
        </div>
      )}

      <section className={cardCls}>
        <h2 className="mb-4 text-base font-black tracking-tight text-slate-900">{t("safetySosTitle")}</h2>
        <ol className="flex flex-col gap-3">
          {SOS_STEPS.map((key, i) => (
            <li key={key} className="flex items-start gap-3 text-sm text-slate-700">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-600 text-xs font-black text-white">{i + 1}</span>
              <span className="pt-1">{t(key)}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm font-semibold text-amber-900">
          {t("safetySosEmergency")}
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-base font-black tracking-tight text-slate-900">{t("safetyContactTitle")}</h2>
        <EmergencyContactCard />
      </section>

      <section className={cardCls}>
        <h2 className="mb-4 text-base font-black tracking-tight text-slate-900">{t("safetyTipsTitle")}</h2>
        <ul className="flex flex-col gap-3">
          {TIPS.map((key) => (
            <li key={key} className="flex items-start gap-3 text-sm text-slate-700">
              <IconCheckCircle size={18} className="mt-0.5 shrink-0 text-emerald-600" />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
