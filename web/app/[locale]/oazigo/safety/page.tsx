"use client";
import { useTranslations } from "next-intl";
import EmergencyContactCard from "@/components/EmergencyContactCard";

export default function OaziGoSafetyPage() {
  const t = useTranslations("OaziGoPage");
  return (
    <div>
      <h1 className="mb-3 text-xl font-black tracking-tight text-slate-900">{t("navSafety")}</h1>
      <EmergencyContactCard />
    </div>
  );
}
