"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";

/** Mirrors the backend's split (transactions.services.split_amounts): the fee is charged only on the payee's share. */
function preview(gross: number, fee: number, refund: number) {
  const payeeGross = gross - refund;
  const payeeFee = refund === 0 ? fee : gross > 0 ? Math.round((fee * payeeGross) / gross) : 0;
  return { payeeFee, payee: payeeGross - payeeFee };
}

interface Props {
  grossXaf: string;
  feeXaf: string;
  payerName: string;
  payeeName: string;
  /** Resolves with an error message to show, or null when the split was saved. */
  onSubmit: (payerAmountXaf: number, notes: string) => Promise<string | null>;
  onCancel: () => void;
}

/** Lets an admin give part of a disputed payment back to the payer and the rest to the payee. */
export default function DisputeSplitForm({ grossXaf, feeXaf, payerName, payeeName, onSubmit, onCancel }: Props) {
  const t = useTranslations("AdminConsolePage");
  const gross = Number(grossXaf);
  const fee = Number(feeXaf);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refund = Number(amount);
  const valid = amount.trim() !== "" && Number.isInteger(refund) && refund > 0 && refund < gross;
  const shares = valid ? preview(gross, fee, refund) : null;
  const xaf = (value: number) => `${value.toLocaleString()} XAF`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setError(t("splitInvalid", { max: (gross - 1).toLocaleString() }));
      return;
    }
    setBusy(true);
    setError("");
    const problem = await onSubmit(refund, notes.trim());
    setBusy(false);
    if (problem) setError(problem);
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 space-y-3">
      <p className="text-xs font-bold text-violet-900">{t("splitTitle", { total: xaf(gross) })}</p>
      <label className="block text-xs font-semibold text-slate-700">
        {t("splitRefundLabel", { name: payerName })}
        <input
          type="number" inputMode="numeric" min={1} max={gross - 1} step={1} required value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="mt-1 block w-48 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900"
        />
      </label>
      {shares && (
        <div className="grid gap-1 rounded-lg bg-white border border-violet-100 p-3 text-xs text-slate-700" aria-live="polite">
          <p>{t("splitPayerGets", { name: payerName, amount: xaf(refund) })}</p>
          <p>{t("splitPayeeGets", { name: payeeName, amount: xaf(shares.payee) })}</p>
          <p className="text-slate-500">{t("splitFee", { amount: xaf(shares.payeeFee) })}</p>
        </div>
      )}
      <label className="block text-xs font-semibold text-slate-700">
        {t("splitNotesLabel")}
        <textarea
          rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("resolutionNotesPlaceholder")}
          className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
        />
      </label>
      <p className="text-[11px] text-slate-500">{t("splitWalletHint")}</p>
      {error && <p role="alert" className="text-xs font-semibold text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="bg-violet-700 hover:bg-violet-600 text-white text-xs font-bold px-4 py-2 rounded-xl disabled:opacity-50 cursor-pointer">
          {busy ? t("splitSaving") : t("splitConfirm")}
        </button>
        <button type="button" onClick={onCancel} className="text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer">
          {t("splitCancel")}
        </button>
      </div>
    </form>
  );
}
