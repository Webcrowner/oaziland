"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { inputCls, pillBtnCls } from "./styles";

/**
 * Inline "why?" picker shown before a rider cancels or a driver releases a ride.
 * The chosen reason (and optional note) is passed on to the other person.
 */
export default function RideReasonForm<R extends string>({
  title, reasons, labelPrefix, confirmLabel, busy, onConfirm, onBack,
}: {
  title: string;
  reasons: readonly R[];
  labelPrefix: "cancelReason" | "releaseReason";
  confirmLabel: string;
  busy: boolean;
  onConfirm: (reason: R, note: string) => void;
  onBack: () => void;
}) {
  const t = useTranslations("OaziGoPage");
  const [reason, setReason] = useState<R | "">("");
  const [note, setNote] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (reason) onConfirm(reason, note.trim());
      }}
      className="mt-3 rounded-2xl border border-red-200 bg-red-50/50 p-4"
    >
      <fieldset>
        <legend className="mb-2.5 text-sm font-black text-slate-900">{title}</legend>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {reasons.map((value) => (
            <label
              key={value}
              className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                reason === value ? "border-red-400 bg-white text-slate-900" : "border-slate-200 bg-white/70 text-slate-600 hover:border-slate-300"
              }`}
            >
              <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} className="accent-red-600" />
              {t(`${labelPrefix}_${value as string}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <textarea
        rows={2}
        maxLength={300}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t("reasonNotePlaceholder")}
        aria-label={t("reasonNotePlaceholder")}
        className={`${inputCls} mt-2.5 resize-none bg-white`}
      />
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={!reason || busy}
          className="rounded-xl bg-red-700 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-red-800 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        >
          {confirmLabel}
        </button>
        <button type="button" onClick={onBack} disabled={busy} className={pillBtnCls}>{t("keepRide")}</button>
      </div>
    </form>
  );
}
