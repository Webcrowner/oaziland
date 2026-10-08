"use client";
import { useTranslations } from "next-intl";

export type ListerRole = "OWNER" | "AGENT" | "AGENCY";

/** Landlord / Agent / Agency label shown on every card. "overlay" sits on the card photo. */
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
  const role: ListerRole = rawRole === "AGENT" || rawRole === "AGENCY" ? rawRole : "OWNER";
  const label = role === "AGENT" ? t("listerAgent") : role === "AGENCY" ? t("listerAgency") : t(isSale ? "listerOwnerSale" : "listerOwner");

  if (variant === "overlay") {
    return (
      <span
        className={`absolute top-2 left-2 text-[11px] font-bold uppercase px-2.5 py-1 rounded-full shadow ${
          role === "OWNER" ? "bg-green-600 text-white" : "bg-[var(--gold)] text-[var(--navy)]"
        }`}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className={`text-xs font-semibold uppercase px-2 py-1 rounded ${
        role === "OWNER" ? "bg-green-100 text-green-800" : "bg-[var(--gold)]/20 text-[#8A6D14]"
      }`}
    >
      {label}
    </span>
  );
}
