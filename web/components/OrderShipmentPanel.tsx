"use client";
import { useFormatter, useTranslations } from "next-intl";
import type { MarketplaceOrderItem } from "@/lib/api";

/** Courier details, the delivery timeline and the proof-of-delivery photo of an order. */
export default function OrderShipmentPanel({ order }: { order: MarketplaceOrderItem }) {
  const t = useTranslations("OrderShipment");
  const format = useFormatter();
  const events = order.shipment_events ?? [];
  if (events.length === 0 && !order.shipment_status) return null;

  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const ordered = [...events].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{t("title")}</p>
        {order.shipment_status && (
          <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-sky-800 border border-sky-200">{t(`status_${order.shipment_status}`)}</span>
        )}
      </div>
      {(order.courier_name || order.tracking_number) && (
        <p className="mt-1 text-sm text-slate-700">
          {[
            order.courier_name ? t("courier", { name: order.courier_name }) : "",
            order.tracking_number ? t("trackingNumber", { number: order.tracking_number }) : "",
          ].filter(Boolean).join(" · ")}
        </p>
      )}
      {ordered.length > 0 && (
        <ol className="mt-2 ml-1.5 border-l-2 border-sky-200 pl-4 flex flex-col gap-2.5">
          {ordered.map((event, index) => (
            <li key={`${event.status}-${event.at}-${index}`} className="relative">
              <span className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-sky-500 ring-2 ring-white" />
              <p className="text-sm font-semibold text-slate-800">{t(`status_${event.status}`)}</p>
              {event.note && <p className="text-sm text-slate-600 whitespace-pre-line">{event.note}</p>}
              <p className="text-xs text-slate-400">{date(event.at)}</p>
            </li>
          ))}
        </ol>
      )}
      {order.delivery_proof_url && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold text-slate-600">{t("proof")}</p>
          <a href={order.delivery_proof_url} target="_blank" rel="noopener noreferrer" className="inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={order.delivery_proof_url} alt={t("proofAlt")} className="h-24 w-24 rounded-lg border border-slate-200 object-cover" />
          </a>
        </div>
      )}
    </div>
  );
}
