"use client";
import { useState, useEffect, useCallback } from "react";
import { getMyWallet, withdrawWallet, type WalletDetail } from "@/lib/api";
import {
  IconCreditCard,
  IconCheckCircle,
  IconAlertCircle,
  IconClock,
  IconShieldCheck,
  IconDownload,
  IconUpload,
  IconX,
} from "@/components/Icons";

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 placeholder:font-normal placeholder:text-slate-400 transition focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-400/15";

const TXN_LABELS: Record<string, string> = {
  RECHARGE: "Wallet top-up",
  GIFT_PAYOUT: "Gift conversion",
  AD_SPEND: "Ad spend",
  WITHDRAWAL: "Withdrawal",
  REFUND: "Refund",
};

const WITHDRAWAL_PILL: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-800",
  APPROVED: "bg-sky-50 text-sky-800",
  PAID_OUT: "bg-emerald-50 text-emerald-800",
  REJECTED: "bg-red-50 text-red-700",
};

function humanize(value: string) {
  return value.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

interface WalletPayoutCardProps {
  title?: string;
  subtitle?: string;
  onBalanceUpdated?: (newBalance: string) => void;
}

export default function WalletPayoutCard({
  title = "Earnings Wallet & MoMo Payouts",
  subtitle = "Instant cash-out to your MTN Mobile Money or Orange Money account.",
  onBalanceUpdated,
}: WalletPayoutCardProps) {
  const [wallet, setWallet] = useState<WalletDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showWithdrawForm, setShowWithdrawForm] = useState(false);
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [provider, setProvider] = useState<"MTN_MOMO" | "ORANGE_MONEY">("MTN_MOMO");
  const [payoutStatus, setPayoutStatus] = useState<"idle" | "processing" | "success" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [tab, setTab] = useState<"transactions" | "withdrawals">("transactions");

  const loadWallet = useCallback(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (!token) {
      setLoading(false);
      return;
    }
    getMyWallet(token)
      .then((data) => {
        setWallet(data);
        if (onBalanceUpdated) onBalanceUpdated(data.balance_xaf);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [onBalanceUpdated]);

  useEffect(() => {
    void Promise.resolve().then(() => loadWallet());
  }, [loadWallet]);

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;

    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) {
      setPayoutStatus("error");
      setStatusMessage("Please enter a valid amount to withdraw.");
      return;
    }

    setPayoutStatus("processing");
    setStatusMessage("");

    try {
      const result = await withdrawWallet(
        {
          amount_xaf: numAmount,
          phone_number: phone,
          provider: provider,
        },
        token
      );
      setPayoutStatus("success");
      setStatusMessage(result.detail);
      setAmount("");
      loadWallet();
    } catch (err) {
      setPayoutStatus("error");
      setStatusMessage(err instanceof Error ? err.message : "Withdrawal failed.");
    }
  }

  if (loading) {
    return (
      <div className="rounded-3xl bg-white border border-slate-200/90 shadow-xs p-6 space-y-4">
        <div className="h-40 rounded-2xl bg-slate-100 animate-pulse" />
        <div className="h-16 rounded-2xl bg-slate-100 animate-pulse" />
        <div className="h-16 rounded-2xl bg-slate-100 animate-pulse" />
      </div>
    );
  }

  const balance = Number(wallet?.balance_xaf || 0);
  const transactions = wallet?.transactions ?? [];
  const withdrawals = wallet?.withdrawals ?? [];
  const isCreditType = (type: string) => type !== "WITHDRAWAL" && type !== "AD_SPEND";
  const totalIn = transactions.filter((t) => isCreditType(t.transaction_type)).reduce((s, t) => s + Number(t.amount_xaf), 0);
  const totalOut = transactions.filter((t) => !isCreditType(t.transaction_type)).reduce((s, t) => s + Number(t.amount_xaf), 0);
  const pendingPayouts = withdrawals
    .filter((w) => w.status === "PENDING" || w.status === "APPROVED")
    .reduce((s, w) => s + Number(w.amount_xaf), 0);
  const miniStats = [
    { label: "Money in", value: totalIn, tone: "text-emerald-300" },
    { label: "Money out", value: totalOut, tone: "text-rose-300" },
    { label: "Pending payouts", value: pendingPayouts, tone: "text-amber-300" },
  ];

  return (
    <div className="bg-white border border-slate-200/90 rounded-3xl p-4 sm:p-6 shadow-xs space-y-6">
      {/* Wallet Balance Hero Card */}
      <div className="p-6 sm:p-7 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-850 to-slate-950 text-white relative overflow-hidden shadow-lg">
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-amber-500/15 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5 relative z-10">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/10 text-amber-300 text-[10px] font-black uppercase tracking-wider mb-3">
              <IconCreditCard size={12} />
              <span>Available Withdrawable Balance</span>
            </div>
            <p className="text-4xl sm:text-5xl font-black text-white tracking-tight">
              {balance.toLocaleString()} <span className="text-base font-semibold text-slate-300">XAF</span>
            </p>
            <p className="text-xs text-slate-400 mt-2">
              Cleared funds from completed stays, rides, and services
            </p>
          </div>

          <div className="flex flex-col sm:items-end gap-2">
            <button
              onClick={() => {
                setShowWithdrawForm(!showWithdrawForm);
                setPayoutStatus("idle");
              }}
              disabled={balance <= 0}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-slate-950 shadow-md shadow-amber-400/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {showWithdrawForm ? <IconX size={16} /> : <IconUpload size={16} />}
              {showWithdrawForm ? "Hide payout form" : "Withdraw to Mobile Money"}
            </button>
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <IconShieldCheck size={12} className="text-emerald-400" />
              <span>Instant MTN MoMo &amp; Orange Money</span>
            </span>
          </div>
        </div>

        <dl className="relative z-10 mt-6 grid grid-cols-3 gap-2 sm:gap-3">
          {miniStats.map((s) => (
            <div key={s.label} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
              <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{s.label}</dt>
              <dd className={`mt-0.5 text-sm sm:text-base font-black truncate ${s.tone}`}>{s.value.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Cash-Out / Withdrawal Form */}
      {showWithdrawForm && (
        <form onSubmit={handleWithdraw} className="p-5 sm:p-6 rounded-2xl bg-slate-50 border border-slate-200/90 space-y-5 animate-rise-in">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-black text-slate-900">
              Request Mobile Money Payout
            </h4>
            <span className="text-xs text-slate-500 font-semibold shrink-0">
              Max: {balance.toLocaleString()} XAF
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Payout Provider
              </span>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: "MTN_MOMO", label: "MTN Mobile Money", dot: "bg-yellow-400" },
                  { value: "ORANGE_MONEY", label: "Orange Money", dot: "bg-orange-500" },
                ] as const).map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setProvider(p.value)}
                    className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-sm font-bold text-left transition cursor-pointer ${
                      provider === p.value
                        ? "border-amber-400 bg-amber-50 text-slate-900 ring-4 ring-amber-400/15"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className={`h-3 w-3 rounded-full ${p.dot}`} />
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="payout-amount" className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Amount (XAF)
                </label>
                <input
                  id="payout-amount"
                  required
                  type="number"
                  min={100}
                  max={balance}
                  placeholder="e.g. 50000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="payout-phone" className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  MoMo Phone (+237)
                </label>
                <input
                  id="payout-phone"
                  required
                  type="tel"
                  placeholder="+237 6XXXXXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* Quick preset chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-slate-500 font-semibold">Quick amounts:</span>
            {[10000, 25000, 50000, 100000].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmount(String(Math.min(preset, balance)))}
                disabled={balance < preset}
                className="text-xs font-bold px-3 py-1 rounded-full bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-30 cursor-pointer"
              >
                {preset.toLocaleString()}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAmount(String(balance))}
              disabled={balance <= 0}
              className="text-xs font-black px-3 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200 cursor-pointer"
            >
              All ({balance.toLocaleString()})
            </button>
          </div>

          {statusMessage && (
            <div
              className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                payoutStatus === "success"
                  ? "bg-emerald-50 text-emerald-900 border border-emerald-200"
                  : "bg-rose-50 text-rose-900 border border-rose-200"
              }`}
            >
              {payoutStatus === "success" ? (
                <IconCheckCircle size={15} className="text-emerald-600 shrink-0" />
              ) : (
                <IconAlertCircle size={15} className="text-rose-600 shrink-0" />
              )}
              <span>{statusMessage}</span>
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="submit"
              disabled={payoutStatus === "processing"}
              className="px-6 py-3 rounded-xl font-bold text-sm bg-slate-900 text-white hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {payoutStatus === "processing" ? "Processing MoMo Payout..." : "Confirm & Send to Phone"}
            </button>
          </div>
        </form>
      )}

      {/* Transaction & Withdrawal History */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-base font-black tracking-tight text-slate-900">Activity</h4>
          <div className="inline-flex rounded-full bg-slate-100 p-1">
            {([
              { key: "transactions", label: "Transactions", count: transactions.length },
              { key: "withdrawals", label: "Withdrawals", count: withdrawals.length },
            ] as const).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`rounded-full px-4 py-1.5 text-xs font-bold transition cursor-pointer ${
                  tab === t.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {t.label} <span className="text-slate-400">{t.count}</span>
              </button>
            ))}
          </div>
        </div>

        {tab === "transactions" ? (
          transactions.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 py-10 text-center text-sm text-slate-500">
              No transactions yet. Completed bookings, rides and services will appear here.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-100">
              {transactions.map((txn) => {
                const isCredit = isCreditType(txn.transaction_type);
                return (
                  <li key={txn.id} className="flex items-center gap-3.5 px-4 py-3.5">
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                        isCredit ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                      }`}
                    >
                      {isCredit ? <IconDownload size={18} /> : <IconUpload size={18} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-900">
                        {TXN_LABELS[txn.transaction_type] ?? humanize(txn.transaction_type)}
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {new Date(txn.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                        {txn.related_reference ? ` • ${txn.related_reference}` : ""}
                      </p>
                    </div>
                    <span className={`shrink-0 text-sm font-black ${isCredit ? "text-emerald-600" : "text-rose-600"}`}>
                      {isCredit ? "+" : "-"}{Number(txn.amount_xaf).toLocaleString()} XAF
                    </span>
                  </li>
                );
              })}
            </ul>
          )
        ) : withdrawals.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 py-10 text-center text-sm text-slate-500">
            You haven&apos;t requested any withdrawals yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-100">
            {withdrawals.map((w) => (
              <li key={w.id} className="flex items-center gap-3.5 px-4 py-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                  <IconClock size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900">{Number(w.amount_xaf).toLocaleString()} XAF</p>
                  <p className="truncate text-xs text-slate-400">
                    Requested {new Date(w.requested_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${WITHDRAWAL_PILL[w.status] ?? "bg-slate-100 text-slate-700"}`}>
                  {humanize(w.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
