"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { countdownParts, countdownTickMs } from "@/lib/flashSale";

/** "Ends in 2d 4h", switching to a hh:mm:ss clock in the last hour. Renders nothing until mounted so the server and client agree. */
export default function SaleCountdown({ endsAt, className = "" }: { endsAt: string; className?: string }) {
  const t = useTranslations("FlashSale");
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(Date.now());
      timer = setTimeout(tick, countdownTickMs(endsAt));
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [endsAt]);

  if (now === null) return null;
  const parts = countdownParts(endsAt, now);
  const text =
    parts.kind === "ended" ? t("ended")
    : parts.kind === "days" ? t("endsInDaysHours", { days: parts.days, hours: parts.hours })
    : parts.kind === "hours" ? t("endsInHoursMinutes", { hours: parts.hours, minutes: parts.minutes })
    : t("endsInClock", { time: parts.time });
  return <span className={`tabular-nums ${className}`}>{text}</span>;
}
