"use client";
import { useTranslations } from "next-intl";
import Badge from "@/components/ui/Badge";
import { IconCheckCircle } from "@/components/Icons";
import { STATUS_VARIANT } from "./styles";

const RIDE_STATUSES = ["REQUESTED", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;

/** A ride's status in words ("Driver on the way") rather than the raw code ("ACCEPTED"). */
export function RideStatusBadge({ status }: { status: string }) {
  const t = useTranslations("OaziGoPage");
  const known = (RIDE_STATUSES as readonly string[]).includes(status);
  return (
    <Badge variant={STATUS_VARIANT[status] || "neutral"}>
      {known ? t(`status_${status as (typeof RIDE_STATUSES)[number]}`) : status.replace("_", " ")}
    </Badge>
  );
}

const STEPS = [
  { status: "REQUESTED", label: "progressRequested" },
  { status: "ACCEPTED", label: "progressAccepted" },
  { status: "IN_PROGRESS", label: "progressInProgress" },
  { status: "COMPLETED", label: "progressCompleted" },
] as const;

/** Requested → Accepted → On the trip → Done, with the current step highlighted. Not shown for cancelled rides. */
export function TripProgress({ status }: { status: string }) {
  const t = useTranslations("OaziGoPage");
  const current = STEPS.findIndex((s) => s.status === status);
  if (current < 0) return null;
  return (
    <ol aria-label={t("tripProgress")} className="mt-3 flex items-center">
      {STEPS.map((step, i) => {
        const done = i < current || status === "COMPLETED";
        const active = i === current && status !== "COMPLETED";
        return (
          <li key={step.status} aria-current={active ? "step" : undefined} className="flex flex-1 items-center last:flex-none">
            <span className="flex flex-col items-center gap-1">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black ${
                  done ? "bg-emerald-500 text-white" : active ? "bg-slate-900 text-amber-300 ring-4 ring-amber-300/30" : "bg-slate-100 text-slate-400"
                }`}
              >
                {done ? <IconCheckCircle size={14} /> : i + 1}
              </span>
              <span className={`whitespace-nowrap text-[10px] font-bold ${active ? "text-slate-900" : done ? "text-emerald-700" : "text-slate-400"}`}>
                {t(step.label)}
              </span>
            </span>
            {i < STEPS.length - 1 && (
              <span className={`mx-1 mb-4 h-0.5 flex-1 rounded-full ${i < current || status === "COMPLETED" ? "bg-emerald-400" : "bg-slate-200"}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
