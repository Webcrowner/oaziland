"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getMyKycStatus } from "@/lib/api";

export type SellGate = "checking" | "signedOut" | "needsKyc" | "ready";

/**
 * Whether the visitor can post a listing right now. Posting needs a signed-in account that has submitted its
 * identity (KYC) details; approval is not required. If the check itself fails we report "ready" and let the
 * server decide, so a flaky request never blocks someone who is allowed to post.
 */
export function useSellGate(): SellGate {
  const [gate, setGate] = useState<SellGate>("checking");

  useEffect(() => {
    let stale = false;
    const token = localStorage.getItem("access_token");
    const lookup: Promise<SellGate> = token
      ? getMyKycStatus(token).then((kyc): SellGate => (kyc ? "ready" : "needsKyc")).catch((): SellGate => "ready")
      : Promise.resolve("signedOut");
    lookup.then((next) => { if (!stale) setGate(next); });
    return () => { stale = true; };
  }, []);

  return gate;
}

/** The banner explaining what is missing before the visitor can post, with the link that fixes it. */
export default function SellGateNotice({ gate }: { gate: SellGate }) {
  const t = useTranslations("MarketplaceSell");
  if (gate !== "signedOut" && gate !== "needsKyc") return null;

  return (
    <p role="alert" className="mb-5 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      {gate === "signedOut" ? t("signInNeeded") : t("kycNeeded")}{" "}
      <Link href={gate === "signedOut" ? "/login" : "/kyc"} className="font-bold underline">
        {gate === "signedOut" ? t("signIn") : t("kycLink")}
      </Link>
    </p>
  );
}
