"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { updateMarketplaceShipment, type MarketplaceOrderItem, type MarketplaceShipmentStatus } from "@/lib/api";
import { nextShipmentStatuses } from "@/lib/marketplaceOrderFlow";
import MediaUploader from "@/components/MediaUploader";
import Button from "@/components/ui/Button";

/** The seller's delivery update for a tracked order; the first update on a paid order also hands it over. */
export default function ShipmentForm({ order, onSaved }: { order: MarketplaceOrderItem; onSaved: () => void }) {
  const t = useTranslations("ShipmentForm");
  const ts = useTranslations("OrderShipment");
  const steps = nextShipmentStatuses(order.shipment_status);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<MarketplaceShipmentStatus>(steps[0] ?? "DELIVERED");
  const [courier, setCourier] = useState(order.courier_name ?? "");
  const [tracking, setTracking] = useState(order.tracking_number ?? "");
  const [note, setNote] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (steps.length === 0) return null;
  const needsCourier = order.delivery_method === "COURIER";
  const delivered = status === "DELIVERED";
  const valid = (!needsCourier || courier.trim().length > 0) && (!delivered || proofUrl !== "" || note.trim().length > 0);

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>{t(order.status === "PAID" ? "open_ship" : "open_update")}</Button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || !valid) return;
    setBusy(true);
    setError("");
    try {
      await updateMarketplaceShipment(order.id, {
        status,
        courier_name: courier.trim(),
        tracking_number: tracking.trim(),
        note: note.trim(),
        ...(delivered && proofUrl ? { proof_url: proofUrl } : {}),
      }, token);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-xl border border-sky-200 bg-sky-50/50 p-3">
      <p className="text-sm font-semibold text-slate-800">{t("title")}</p>
      {order.status === "PAID" && <p className="text-xs text-slate-600">{t("handOverNote")}</p>}
      {order.delivery_address && <p className="text-xs text-slate-600">{t("address", { address: order.delivery_address })}</p>}
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        {t("status")}
        <select value={status} onChange={(e) => setStatus(e.target.value as MarketplaceShipmentStatus)} className="border rounded-lg px-3 py-2 text-sm bg-white">
          {steps.map((step) => <option key={step} value={step}>{ts(`status_${step}`)}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        {needsCourier ? t("courierRequired") : t("courierOptional")}
        <input value={courier} onChange={(e) => setCourier(e.target.value)} required={needsCourier} maxLength={120} className="border rounded-lg px-3 py-2 text-sm bg-white" />
      </label>
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        {t("trackingNumber")}
        <input value={tracking} onChange={(e) => setTracking(e.target.value)} maxLength={120} className="border rounded-lg px-3 py-2 text-sm bg-white" />
      </label>
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        {delivered ? t("noteDelivered") : t("note")}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className="border rounded-lg px-3 py-2 text-sm bg-white" />
      </label>
      {delivered && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-slate-700">{t("proof")}</p>
          <p className="text-xs text-slate-500">{t("proofHint")}</p>
          {proofUrl ? (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={proofUrl} alt={t("proofAlt")} className="h-16 w-16 rounded-lg border border-slate-200 object-cover" />
              <button type="button" onClick={() => setProofUrl("")} className="text-sm font-semibold text-red-700 underline cursor-pointer">{t("removeProof")}</button>
            </div>
          ) : (
            <MediaUploader folder="marketplace" multiple={false} accept="image/*" label={t("addProof")} onUploaded={(result) => setProofUrl(result.url)} />
          )}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || !valid}>{busy ? t("saving") : t("submit")}</Button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm font-semibold text-slate-500 cursor-pointer">{t("cancel")}</button>
      </div>
    </form>
  );
}
