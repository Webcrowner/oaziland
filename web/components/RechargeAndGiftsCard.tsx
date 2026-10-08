"use client";
import { useState, useEffect, useCallback } from "react";
import { rechargeWallet, getMyGifts, convertGiftsToWalletBalance, type GiftItem } from "@/lib/api";
import { IconCreditCard, IconGift, IconCheckCircle, IconAlertCircle } from "@/components/Icons";

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm font-semibold text-slate-900 placeholder:font-normal placeholder:text-slate-400 transition focus:bg-white focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-400/15";

/**
 * Real wallet recharge + gift economy card — recharge_wallet()/
 * send_gift()/convert_gifts_to_wallet_balance() were fully built and
 * tested, but neither had any reachable endpoint or UI before this.
 */
export default function RechargeAndGiftsCard({ onWalletChanged }: { onWalletChanged?: () => void }) {
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [rechargeStatus, setRechargeStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [gifts, setGifts] = useState<GiftItem[]>([]);
  const [unconvertedPoints, setUnconvertedPoints] = useState(0);
  const [convertStatus, setConvertStatus] = useState<"idle" | "converting" | "converted" | "error">("idle");

  const loadGifts = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getMyGifts(token).then((data) => { setGifts(data.results); setUnconvertedPoints(data.unconverted_points); }).catch(() => {});
  }, []);

  useEffect(() => {
    loadGifts();
  }, [loadGifts]);

  async function handleRecharge(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || !amount || !phone) return;
    setRechargeStatus("submitting");
    try {
      await rechargeWallet(amount, phone, token);
      setRechargeStatus("done");
      setAmount("");
      onWalletChanged?.();
    } catch {
      setRechargeStatus("error");
    }
  }

  async function handleConvert() {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setConvertStatus("converting");
    try {
      await convertGiftsToWalletBalance(token);
      setConvertStatus("converted");
      loadGifts();
      onWalletChanged?.();
    } catch {
      setConvertStatus("error");
    }
  }

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-xs">
        <div className="flex items-center gap-3 mb-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-amber-300">
            <IconCreditCard size={20} />
          </span>
          <div>
            <h3 className="text-base font-black tracking-tight text-slate-900">Top Up Your Wallet</h3>
            <p className="text-xs text-slate-500">Add funds via MTN MoMo or Orange Money.</p>
          </div>
        </div>
        <form onSubmit={handleRecharge} className="flex flex-col gap-3">
          <input type="number" min={100} placeholder="Amount (XAF)" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
          <input type="tel" placeholder="+237 6XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
          <div className="flex flex-wrap gap-2">
            {[5000, 10000, 25000, 50000].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmount(String(preset))}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                {preset.toLocaleString()}
              </button>
            ))}
          </div>
          <button
            disabled={rechargeStatus === "submitting" || !amount || !phone}
            className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {rechargeStatus === "submitting" ? "Processing..." : "Recharge via MoMo"}
          </button>
        </form>
        {rechargeStatus === "done" && (
          <p className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">
            <IconCheckCircle size={16} className="shrink-0" /> Wallet recharged.
          </p>
        )}
        {rechargeStatus === "error" && (
          <p className="mt-3 flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            <IconAlertCircle size={16} className="shrink-0" /> Recharge failed — please try again.
          </p>
        )}
      </section>

      <section className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-xs">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <IconGift size={20} />
            </span>
            <h3 className="text-base font-black tracking-tight text-slate-900">Gifts Received</h3>
          </div>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">{unconvertedPoints} pts</span>
        </div>
        {gifts.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 py-6 text-center text-sm text-slate-500">
            No gifts received yet.
          </p>
        ) : (
          <ul className="mb-4 divide-y divide-slate-100">
            {gifts.slice(0, 5).map((gift) => (
              <li key={gift.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0 truncate text-slate-700">
                  <span className="font-bold text-slate-900">{gift.sender_name}</span> sent a {gift.gift_type.replace("_", " ").toLowerCase()}
                </span>
                <span className="shrink-0 text-xs font-bold text-amber-700">+{gift.point_value} pts</span>
              </li>
            ))}
          </ul>
        )}
        {unconvertedPoints > 0 && (
          <button
            onClick={handleConvert}
            disabled={convertStatus === "converting"}
            className="w-full rounded-xl bg-amber-400 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-amber-300 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {convertStatus === "converting" ? "Converting..." : "Convert Gifts to Wallet Balance"}
          </button>
        )}
        {convertStatus === "converted" && (
          <p className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">
            <IconCheckCircle size={16} className="shrink-0" /> Converted to wallet balance.
          </p>
        )}
      </section>
    </div>
  );
}
