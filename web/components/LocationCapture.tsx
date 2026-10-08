"use client";
import { useTranslations } from "next-intl";
import GpsCaptureButton from "@/components/GpsCaptureButton";

export interface GpsValue {
  latitude: number | null;
  longitude: number | null;
}

export const EMPTY_GPS: GpsValue = { latitude: null, longitude: null };

/** Optional "capture my current location" block shared by every listing form. */
export default function LocationCapture({
  value,
  onChange,
  className = "",
}: {
  value: GpsValue;
  onChange: (value: GpsValue) => void;
  className?: string;
}) {
  const t = useTranslations("LocationCapture");
  return (
    <div className={`p-4 rounded-2xl bg-amber-50/50 border border-amber-200/70 ${className}`}>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-900 mb-2">{t("title")}</label>
      <GpsCaptureButton
        onCapture={(coords) => onChange(coords)}
        currentCoords={value}
        onClear={() => onChange(EMPTY_GPS)}
        label={t("capture")}
        clearLabel={t("remove")}
        hint={t("hint")}
      />
    </div>
  );
}
