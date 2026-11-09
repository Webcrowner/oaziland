"use client";
import { createContext, useContext, useState } from "react";
import { useTranslations } from "next-intl";
import { getDataAdminLink } from "@/lib/api";
import { IconArrowUpRight } from "@/components/Icons";

/** The console's session token when the signed-in admin has full access (the data admin is theirs only), else null. */
export const DataAdminAccess = createContext<string | null>(null);

/** Data admin addresses (Django admin) for the records the console shows. */
export const dataAdminPath = {
  user: (id: string) => `/admin/identity/user/${id}/change/`,
  kyc: (id: string | number) => `/admin/identity/kycprofile/${id}/change/`,
  report: (id: string) => `/admin/trust_safety/contentreport/${id}/change/`,
  dispute: (id: string) => `/admin/property_management/disputecase/${id}/change/`,
  withdrawal: (id: string) => `/admin/monetization/withdrawalrequest/${id}/change/`,
  booking: (id: string) => `/admin/transactions/booking/${id}/change/`,
  propertyListing: (id: string) => `/admin/property/listing/${id}/change/`,
  marketplaceListing: (id: string) => `/admin/marketplace/marketplacelistingbase/${id}/change/`,
  post: (id: string) => `/admin/social/post/${id}/change/`,
  verificationRequest: (id: string) => `/admin/engagement/verificationrequest/${id}/change/`,
  deletionRequest: (id: string) => `/admin/engagement/accountdeletionrequest/${id}/change/`,
};

/** Opens a data admin page in a new tab, signed in with the console session. Returns false if it couldn't. */
export async function openInDataAdmin(token: string, path?: string): Promise<boolean> {
  // Opened before the request so the browser doesn't treat it as an unrequested popup.
  const tab = window.open("about:blank", "_blank");
  try {
    const url = await getDataAdminLink(token, path);
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.location.href = url;
    }
    return true;
  } catch {
    tab?.close();
    return false;
  }
}

/** "Open in data admin ↗" for one record; renders nothing for limited admins. */
export default function DataAdminLink({ path, className = "" }: { path: string; className?: string }) {
  const token = useContext(DataAdminAccess);
  const t = useTranslations("AdminConsolePage");
  const [failed, setFailed] = useState(false);
  if (!token) return null;

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={async () => setFailed(!(await openInDataAdmin(token, path)))}
        title={t("openInDataAdminHint")}
        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-amber-700 underline-offset-2 hover:underline cursor-pointer"
      >
        {t("openInDataAdmin")}
        <IconArrowUpRight size={12} />
      </button>
      {failed && <span role="alert" className="text-[11px] text-red-600">{t("dataAdminFailed")}</span>}
    </span>
  );
}
