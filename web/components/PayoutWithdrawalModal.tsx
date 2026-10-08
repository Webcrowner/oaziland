"use client";
import { useState, useEffect } from "react";
import { getMyWallet, withdrawWallet, type WalletDetail } from "@/lib/api";
import Button from "@/components/ui/Button";
import {
  IconLock,
  IconShieldCheck,
  IconCheckCircle,
  IconAlertCircle,
  IconCreditCard,
} from "@/components/Icons";

interface PayoutWithdrawalModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultPhone?: string;
  onSuccess?: () => void;
}

export default function PayoutWithdrawalModal({
  isOpen,
  onClose,
  defaultPhone = "",
  onSuccess,
}: PayoutWithdrawalModalProps) {
  const [wallet, setWallet] = useState<WalletDetail | null>(null);
  const [loadingWallet, setLoadingWallet] = useState(true);
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState(defaultPhone);
  const [provider, setProvider] = useState<"MTN_MOMO" | "ORANGE_MONEY">("MTN_MOMO");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [successDetail, setSuccessDetail] = useState("");

  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;

  useEffect(() => {
    if (isOpen && token) {
      setLoadingWallet(true);
      getMyWallet(token)
        .then((w) => {
          setWallet(w);
          if (!phone && defaultPhone) setPhone(defaultPhone);
        })
        .catch(() => {})
        .finally(() => setLoadingWallet(false));
    }
  }, [isOpen, token, defaultPhone]);

  if (!isOpen) return null;

  const currentBalance = wallet ? Number(wallet.balance_xaf) : 0;

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    const withdrawAmount = Number(amount);
    if (!withdrawAmount || withdrawAmount <= 0) {
      setErrorMessage("Please enter a valid amount to withdraw.");
      return;
    }
    if (withdrawAmount > currentBalance) {
      setErrorMessage(`Insufficient balance. You have ${currentBalance.toLocaleString()} XAF available.`);
      return;
    }

    setStatus("submitting");
    setErrorMessage("");

    try {
      const res = await withdrawWallet(
        {
          amount_xaf: withdrawAmount,
          phone_number: phone,
          provider,
        },
        token
      );
      setSuccessDetail(res.detail);
      setStatus("success");
      if (onSuccess) onSuccess();
    } catch (err: unknown) {
      setStatus("error");
      const msg = err instanceof Error ? err.message : "Withdrawal request failed";
      setErrorMessage(msg);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border border-slate-200/90 relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between pb-3 border-b border-slate-100 mb-4">
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 inline-flex items-center gap-1 mb-1">
              <IconShieldCheck size={11} />
              <span>Fapshi Instant Payout</span>
            </span>
            <h3 className="font-black text-slate-900 text-lg leading-tight">
              Withdraw Earnings
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Direct transfer to your Cameroon Mobile Money account
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {status === "success" ? (
          <div className="text-center py-4 space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto shadow-inner">
              <IconCheckCircle size={32} />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 text-xl">
                Payout Disbursed!
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                {successDetail || `Transferred ${Number(amount).toLocaleString()} XAF to ${phone}.`}
              </p>
            </div>
            <div className="pt-2">
              <Button onClick={onClose} className="w-full">
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleWithdraw} className="space-y-4">
            {/* Balance Badge */}
            <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-950 text-white flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                  Available Wallet Balance
                </p>
                <p className="text-2xl font-black text-amber-400">
                  {loadingWallet ? "..." : `${currentBalance.toLocaleString()} XAF`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAmount(String(currentBalance))}
                className="text-[11px] font-extrabold px-2.5 py-1 rounded-lg bg-amber-400/20 text-amber-300 hover:bg-amber-400/30 transition-colors"
              >
                Max All
              </button>
            </div>

            {/* Provider selection */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Payout Network (Cameroon)
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setProvider("MTN_MOMO")}
                  className={`p-3 rounded-xl border text-xs font-bold transition-all text-left flex items-center gap-2 ${
                    provider === "MTN_MOMO"
                      ? "border-amber-500 bg-amber-50/60 text-slate-900 shadow-xs"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                  <span>MTN MoMo</span>
                </button>
                <button
                  type="button"
                  onClick={() => setProvider("ORANGE_MONEY")}
                  className={`p-3 rounded-xl border text-xs font-bold transition-all text-left flex items-center gap-2 ${
                    provider === "ORANGE_MONEY"
                      ? "border-orange-500 bg-orange-50/60 text-slate-900 shadow-xs"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                  <span>Orange Money</span>
                </button>
              </div>
            </div>

            {/* Amount input */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                Amount to Cash Out (XAF)
              </label>
              <div className="relative">
                <input
                  required
                  type="number"
                  min={500}
                  max={currentBalance || undefined}
                  placeholder="e.g. 50000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-black text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                />
                <span className="absolute right-3.5 top-2.5 text-xs font-bold text-slate-400">
                  XAF
                </span>
              </div>
            </div>

            {/* Destination Phone */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                Recipient Mobile Money Number
              </label>
              <input
                required
                type="tel"
                placeholder="+237 6XXXXXXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Processed via Fapshi disbursement directly to your local phone wallet.
              </p>
            </div>

            {errorMessage && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 flex items-center gap-2">
                <IconAlertCircle size={14} className="text-rose-600 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button
                type="submit"
                disabled={status === "submitting" || currentBalance <= 0}
                className="flex-1 py-3 text-xs font-black shadow-md shadow-amber-500/20"
              >
                {status === "submitting" ? "Processing Payout..." : "Confirm & Send to MoMo"}
              </Button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
