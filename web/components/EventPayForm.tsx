"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getEventBooking, payEventBooking } from "@/lib/api";
import { MomoBadges } from "@/components/PaymentIcons";

const WAIT_LIMIT_MS = 8 * 60 * 1000;

/** Pays a venue booking's deposit or balance with Mobile Money. A real payment is confirmed by the provider after the
 * payer approves it on their phone, so after starting it we ask the server every few seconds until it is held. */
export default function EventPayForm({ bookingId, part, amountXaf, onPaid }: {
  bookingId: string;
  part: "deposit" | "balance";
  amountXaf: string | number;
  onPaid: () => void;
}) {
  const t = useTranslations("EventPayment");
  const locale = useLocale();
  const [phone, setPhone] = useState("");
  const [step, setStep] = useState<"idle" | "starting" | "waiting">("idle");
  const [error, setError] = useState("");
  const startedAt = useRef(0);
  const amount = new Intl.NumberFormat(locale).format(Number(amountXaf));

  useEffect(() => {
    if (step !== "waiting") return;
    const token = localStorage.getItem("access_token");
    if (!token) return;
    startedAt.current = Date.now();
    let stopped = false;
    const check = async () => {
      try {
        const b = await getEventBooking(bookingId, token);
        if (stopped) return;
        const paid = part === "deposit" ? b.deposit_paid : b.balance_paid;
        if (paid) {
          onPaid();
        } else if (b.status === "CANCELLED") {
          setError(t("refunded"));
          setStep("idle");
        } else if (Date.now() - startedAt.current > WAIT_LIMIT_MS) {
          setError(t("timedOut"));
          setStep("idle");
        }
      } catch {
        // A failed check is not a failed payment: keep waiting and ask again.
      }
    };
    const timer = window.setInterval(check, 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [step, bookingId, part, onPaid, t]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setStep("starting");
    setError("");
    try {
      const result = await payEventBooking(bookingId, part, phone.trim(), token);
      if (result.confirmed) onPaid();
      else setStep("waiting");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
      setStep("idle");
    }
  }

  if (step === "waiting") {
    return (
      <p role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
        {t("waiting", { phone, amount })}
      </p>
    );
  }

  return (
    <form onSubmit={start} className="flex flex-col gap-2">
      <label className="text-xs font-semibold text-slate-600">
        <span className="flex items-center justify-between gap-2">
          <span>{t("phoneLabel")}</span>
          <MomoBadges size={15} />
        </span>
        <input
          required type="tel" placeholder="+237 6XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)}
          className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
        />
      </label>
      {error && <p role="alert" className="text-xs font-semibold text-rose-700">{error}</p>}
      <button
        type="submit" disabled={step === "starting" || phone.trim().length < 8}
        className="self-start rounded-lg border border-slate-900 bg-slate-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-50 cursor-pointer"
      >
        {step === "starting" ? t("starting") : t(part === "deposit" ? "payDeposit" : "payBalance", { amount })}
      </button>
    </form>
  );
}
