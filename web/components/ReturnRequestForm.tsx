"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  requestMarketplaceReturn, type MarketplaceOrderItem, type MarketplaceReturnKind, type MarketplaceReturnReason,
} from "@/lib/api";
import MediaUploader from "@/components/MediaUploader";
import Button from "@/components/ui/Button";

const KINDS: MarketplaceReturnKind[] = ["REFUND", "PARTIAL_REFUND", "REPLACEMENT"];
const REASONS: MarketplaceReturnReason[] = ["NOT_AS_DESCRIBED", "DAMAGED", "WRONG_ITEM", "MISSING_PARTS", "NOT_WORKING", "OTHER"];
const MAX_EVIDENCE = 5;
const MIN_DESCRIPTION = 10;

/** The buyer's request for a full refund, a partial refund or a replacement, with up to five evidence photos. */
export default function ReturnRequestForm({ order, onSaved, onCancel }: { order: MarketplaceOrderItem; onSaved: () => void; onCancel: () => void }) {
  const t = useTranslations("ReturnRequestForm");
  const tr = useTranslations("OrderReturn");
  const [kind, setKind] = useState<MarketplaceReturnKind>("REFUND");
  const [reason, setReason] = useState<MarketplaceReturnReason>("NOT_AS_DESCRIBED");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [evidence, setEvidence] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const orderAmount = Number(order.amount_xaf);
  const amountValue = Number(amount);
  const amountOk = kind !== "PARTIAL_REFUND" || (Number.isFinite(amountValue) && amountValue > 0 && amountValue < orderAmount);
  const valid = description.trim().length >= MIN_DESCRIPTION && amountOk;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || !valid) return;
    setBusy(true);
    setError("");
    try {
      await requestMarketplaceReturn(order.id, {
        kind, reason, description: description.trim(),
        ...(evidence.length > 0 ? { evidence_urls: evidence } : {}),
        ...(kind === "PARTIAL_REFUND" ? { requested_amount_xaf: String(Math.round(amountValue)) } : {}),
      }, token);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
      <p className="text-sm font-semibold text-slate-800">{t("title")}</p>
      <fieldset className="flex flex-col gap-1.5 text-sm text-slate-700">
        <legend className="mb-1 font-semibold">{t("kind")}</legend>
        {KINDS.map((value) => (
          <label key={value} className="flex items-center gap-2">
            <input type="radio" name={`return-kind-${order.id}`} checked={kind === value} onChange={() => setKind(value)} />
            {tr(`kind_${value}`)}
          </label>
        ))}
      </fieldset>
      {kind === "PARTIAL_REFUND" && (
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          {t("amount", { max: orderAmount.toLocaleString() })}
          <input
            type="number" min={1} max={Math.max(1, orderAmount - 1)} step={1} required value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-48 border rounded-lg px-3 py-2 text-sm bg-white"
          />
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        {t("reason")}
        <select value={reason} onChange={(e) => setReason(e.target.value as MarketplaceReturnReason)} className="border rounded-lg px-3 py-2 text-sm bg-white">
          {REASONS.map((value) => <option key={value} value={value}>{tr(`reason_${value}`)}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        {t("description")}
        <textarea
          value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={2000} placeholder={t("descriptionPlaceholder")}
          className="border rounded-lg px-3 py-2 text-sm bg-white"
        />
      </label>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-slate-700">{t("evidence", { max: MAX_EVIDENCE })}</p>
        {evidence.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {evidence.map((url) => (
              <li key={url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={t("evidenceAlt")} className="h-16 w-16 rounded-lg border border-slate-200 object-cover" />
                <button
                  type="button" aria-label={t("removeEvidence")} onClick={() => setEvidence((prev) => prev.filter((u) => u !== url))}
                  className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-red-600 text-xs font-bold leading-5 text-white cursor-pointer"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {evidence.length < MAX_EVIDENCE && (
          <MediaUploader
            folder="marketplace" accept="image/*" label={t("addEvidence")}
            onUploaded={(result) => setEvidence((prev) => (prev.length < MAX_EVIDENCE && !prev.includes(result.url) ? [...prev, result.url] : prev))}
          />
        )}
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || !valid}>{busy ? t("sending") : t("submit")}</Button>
        <button type="button" onClick={onCancel} className="text-sm font-semibold text-slate-500 cursor-pointer">{t("cancel")}</button>
      </div>
    </form>
  );
}
