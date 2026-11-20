"use client";
import { useEffect, useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { boostMarketplaceListing, getMarketplaceBoostOptions, type MarketplaceBoostOption, type MarketplaceCategory } from "@/lib/api";
import { MomoBadges } from "@/components/PaymentIcons";

/** Buy a TOP boost for a listing: shown first with a TOP badge for the days chosen, paid from the wallet or by Mobile Money. */
export default function MarketplaceBoostPanel({
  category, listingId, onBoosted, onClose,
}: {
  category: MarketplaceCategory;
  listingId: string;
  onBoosted: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("MarketplaceBoost");
  const format = useFormatter();
  const locale = useLocale();
  const [options, setOptions] = useState<MarketplaceBoostOption[] | null>(null);
  const [unit, setUnit] = useState<"DAILY" | "MONTHLY">("DAILY");
  const [quantity, setQuantity] = useState(7);
  const [payWith, setPayWith] = useState<"WALLET" | "MOMO">("WALLET");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [boostedUntil, setBoostedUntil] = useState<string | null>(null);

  useEffect(() => {
    getMarketplaceBoostOptions()
      .then((rows) => {
        setOptions(rows);
        if (rows.length > 0) setUnit(rows[0].duration_unit);
      })
      .catch(() => setOptions([]));
  }, []);

  const option = options?.find((o) => o.duration_unit === unit);
  const maxQuantity = option?.max_quantity ?? 1;
  const safeQuantity = Math.min(maxQuantity, Math.max(1, quantity));
  const total = option ? Number(option.unit_price_xaf) * safeQuantity : 0;
  const money = (value: number) => `${new Intl.NumberFormat(locale).format(value)} XAF`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || !option) return;
    setBusy(true);
    setError("");
    try {
      const result = await boostMarketplaceListing(
        category, listingId, { duration_unit: unit, quantity: safeQuantity, pay_with: payWith, phone_number: payWith === "MOMO" ? phone.trim() : "" }, token,
      );
      setBoostedUntil(result.boosted_until);
      onBoosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  if (boostedUntil) {
    return (
      <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
        <p className="font-semibold">{t("done", { date: format.dateTime(new Date(boostedUntil), { dateStyle: "medium", timeStyle: "short" }) })}</p>
        <button onClick={onClose} className="mt-1 text-xs font-semibold underline cursor-pointer">{t("close")}</button>
      </div>
    );
  }

  if (options === null) return <p className="mt-3 text-sm text-slate-400">...</p>;
  if (options.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        {t("unavailable")}
        <button onClick={onClose} className="ml-2 text-xs font-semibold underline cursor-pointer">{t("close")}</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm font-semibold text-[var(--navy)]">{t("title")}</p>
      <p className="text-xs text-slate-600">{t("explainer")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <select value={unit} onChange={(e) => setUnit(e.target.value as "DAILY" | "MONTHLY")} aria-label={t("length")} className="border rounded-lg px-3 py-1.5 text-sm">
          {options.map((o) => <option key={o.duration_unit} value={o.duration_unit}>{t(`unit_${o.duration_unit}`, { price: money(Number(o.unit_price_xaf)) })}</option>)}
        </select>
        <input
          type="number" min={1} max={maxQuantity} step={1} required value={quantity}
          onChange={(e) => setQuantity(Math.floor(Number(e.target.value) || 1))}
          aria-label={t("quantity")} className="w-20 border rounded-lg px-2 py-1.5 text-sm text-right"
        />
        <span className="text-xs text-slate-500">{t("max", { count: maxQuantity })}</span>
      </div>
      <fieldset className="flex flex-wrap gap-4 text-sm text-slate-700">
        <label className="flex items-center gap-1.5"><input type="radio" name={`pay-${listingId}`} checked={payWith === "WALLET"} onChange={() => setPayWith("WALLET")} /> {t("payWallet")}</label>
        <label className="flex items-center gap-1.5"><input type="radio" name={`pay-${listingId}`} checked={payWith === "MOMO"} onChange={() => setPayWith("MOMO")} /> <span>{t("payMomo")}</span> <MomoBadges size={14} /></label>
      </fieldset>
      {payWith === "MOMO" && (
        <input
          type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)}
          placeholder={t("phonePlaceholder")} aria-label={t("phonePlaceholder")} className="border rounded-lg px-3 py-2 text-sm"
        />
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || !option || (payWith === "MOMO" && !phone.trim())} className="rounded-lg bg-[var(--navy)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 cursor-pointer">
          {busy ? t("paying") : t("buy", { amount: money(total) })}
        </button>
        <button type="button" onClick={onClose} className="text-sm font-semibold text-slate-500 cursor-pointer">{t("cancel")}</button>
      </div>
    </form>
  );
}
