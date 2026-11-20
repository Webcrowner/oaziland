"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getMyPartnerServiceRequests, PARTNER_SERVICE_REQUESTED_EVENT, type PartnerServiceRequestItem } from "@/lib/api";
import Badge from "@/components/ui/Badge";

const STATUS_VARIANT = { REQUESTED: "gold", IN_PROGRESS: "navy", COMPLETED: "green", CANCELLED: "clay" } as const;

/** The signed-in user's partner-service requests, so a request can be followed after it is sent. */
export default function MyPartnerRequests() {
  const t = useTranslations("ServicesPage");
  const locale = useLocale();
  const [requests, setRequests] = useState<PartnerServiceRequestItem[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const load = () => {
      const token = localStorage.getItem("access_token");
      if (!token) return;
      getMyPartnerServiceRequests(token)
        .then((data) => {
          setRequests(data.results);
          setFailed(false);
        })
        .catch(() => setFailed(true));
    };
    load();
    // A request sent from a card on this page shows up here without a refresh.
    window.addEventListener(PARTNER_SERVICE_REQUESTED_EVENT, load);
    return () => window.removeEventListener(PARTNER_SERVICE_REQUESTED_EVENT, load);
  }, []);

  if (failed) {
    return <p role="alert" className="mb-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{t("myRequestsFailed")}</p>;
  }
  if (requests.length === 0) return null;

  return (
    <section aria-label={t("myRequests")} className="mb-8 rounded-lg border bg-white p-4">
      <h2 className="mb-3 text-lg font-semibold text-[var(--navy)]">{t("myRequests")}</h2>
      <ul className="flex flex-col divide-y">
        {requests.map((request) => (
          <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">{request.offering_name}</p>
              <p className="text-xs text-gray-500">{new Date(request.requested_at).toLocaleDateString(locale)}</p>
            </div>
            <Badge variant={STATUS_VARIANT[request.status] ?? "neutral"}>{t(`requestStatus_${request.status}`)}</Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}
