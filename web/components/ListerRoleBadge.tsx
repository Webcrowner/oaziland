"use client";
import { useTranslations } from "next-intl";

export type ListerRole = "OWNER" | "AGENT" | "AGENCY" | "PLATFORM";

/** Landlord / Agent / Agency / Oaziland official label shown on every card. "overlay" sits on the card photo. */
export default function ListerRoleBadge({
  role: rawRole,
  isSale = false,
  variant = "inline",
}: {
  role?: string;
  isSale?: boolean;
  variant?: "inline" | "overlay";
}) {
  const t = useTranslations("PropertyCard");
  if (!rawRole) return null;
  const role: ListerRole = rawRole === "AGENT" || rawRole === "AGENCY" || rawRole === "PLATFORM" ? rawRole : "OWNER";
  const label =
    role === "PLATFORM" ? t("listerPlatform")
    : role === "AGENT" ? t("listerAgent")
    : role === "AGENCY" ? t("listerAgency")
    : t(isSale ? "listerOwnerSale" : "listerOwner");
  const overlayTone = role === "PLATFORM" ? "bg-[var(--navy)] text-white" : role === "OWNER" ? "bg-green-600 text-white" : "bg-[var(--gold)] text-[var(--navy)]";
  const inlineTone = role === "PLATFORM" ? "bg-[var(--navy)]/10 text-[var(--navy)]" : role === "OWNER" ? "bg-green-100 text-green-800" : "bg-[var(--gold)]/20 text-[#8A6D14]";

  if (variant === "overlay") {
    return (
      <span
        className={`absolute top-2 left-2 text-[11px] font-bold uppercase px-2.5 py-1 rounded-full shadow ${overlayTone}`}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className={`text-xs font-semibold uppercase px-2 py-1 rounded ${inlineTone}`}
    >
      {label}
    </span>
  );
}
