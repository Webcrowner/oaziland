"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getAdminPricing, setAdminBoostPrice, setAdminFeePercent, type AdminPricing } from "@/lib/api";
import type { useAdminDialogs } from "@/components/admin/useAdminDialogs";

interface Props {
  token: string;
  dialogs: ReturnType<typeof useAdminDialogs>;
}

const inputClass =
  "w-28 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-right text-sm font-semibold text-slate-900 focus:border-amber-500 focus:outline-none";

/** Platform fee per kind of payment, and the boost price list. Full-access admins only. */
export default function AdminPricingEditor({ token, dialogs }: Props) {
  const t = useTranslations("AdminConsolePage");
  const [data, setData] = useState<AdminPricing | null>(null);
  const [error, setError] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getAdminPricing(token));
      setError(false);
    } catch {
      setError(true);
    }
  }, [token]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function readError(res: Response) {
    const body = await res.json().catch(() => null);
    const field = body && typeof body === "object" ? Object.values(body).flat()[0] : null;
    return typeof body?.detail === "string" ? body.detail : typeof field === "string" ? field : t("actionFailed");
  }

  const feeKey = (category: string) => `fee:${category}`;
  const boostKey = (placement: string, unit: string) => `boost:${placement}:${unit}`;
  const draftOf = (key: string, current: string | null) => drafts[key] ?? (current === null ? "" : String(Number(current)));
  const isDirty = (key: string, current: string | null) => key in drafts && drafts[key].trim() !== (current === null ? "" : String(Number(current)));

  function clearDraft(key: string) {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function saveFee(category: string, label: string, current: string | null) {
    const key = feeKey(category);
    const value = draftOf(key, current).trim();
    if (!value || busyKey) return;
    const message = t("pricingFeeConfirm", { label, old: current === null ? t("pricingNotSet") : `${Number(current)}%`, value: `${Number(value)}%` });
    if (!(await dialogs.confirm(message, { confirmLabel: t("pricingSave"), destructive: current !== null && Number(value) > Number(current) * 2 && Number(value) > 10 }))) return;
    setBusyKey(key);
    try {
      const res = await setAdminFeePercent(category, value, token);
      if (!res.ok) {
        await dialogs.notify(await readError(res));
        return;
      }
      setData(await res.json());
      clearDraft(key);
    } finally {
      setBusyKey(null);
    }
  }

  async function saveBoost(placement: string, unit: string, label: string, current: string | null, remove: boolean) {
    const key = boostKey(placement, unit);
    const value = draftOf(key, current).trim();
    if ((!remove && !value) || busyKey) return;
    const message = remove
      ? t("pricingBoostRemoveConfirm", { label })
      : t("pricingBoostConfirm", { label, old: current === null ? t("pricingNotOffered") : `${Number(current).toLocaleString()} XAF`, value: `${Number(value).toLocaleString()} XAF` });
    if (!(await dialogs.confirm(message, { confirmLabel: remove ? t("pricingRemove") : t("pricingSave"), destructive: remove }))) return;
    setBusyKey(key);
    try {
      const res = await setAdminBoostPrice(placement, unit, remove ? null : value, token);
      if (!res.ok) {
        await dialogs.notify(await readError(res));
        return;
      }
      setData(await res.json());
      clearDraft(key);
    } finally {
      setBusyKey(null);
    }
  }

  if (error && !data) {
    return (
      <div className="rounded-2xl border border-dashed border-rose-200 bg-white p-12 text-center">
        <p className="text-sm font-semibold text-rose-700">{t("pricingLoadError")}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
        <p className="text-sm font-semibold text-slate-600">{t("usersLoading")}</p>
      </div>
    );
  }

  const placements = Array.from(new Map(data.boosts.map((b) => [b.placement, b.placement_label])).entries());

  return (
    <div className="space-y-6 animate-rise-in max-w-4xl">
      <p className="text-xs leading-relaxed text-slate-500">{t("pricingIntro")}</p>

      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold text-slate-900">{t("pricingFeesTitle")}</h3>
        <p className="mb-4 mt-1 text-xs text-slate-500">{t("pricingFeesHint", { max: Number(data.max_fee_percent) })}</p>
        <ul className="divide-y divide-slate-100">
          {data.fees.map((fee) => {
            const key = feeKey(fee.category);
            const dirty = isDirty(key, fee.fee_percent);
            return (
              <li key={fee.category} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{t.has(`pricingFee_${fee.category}`) ? t(`pricingFee_${fee.category}`) : fee.label}</p>
                  {fee.fee_percent === null && <p className="text-[11px] font-semibold text-rose-600">{t("pricingFeeMissing")}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={Number(data.max_fee_percent)}
                    step="0.01"
                    value={draftOf(key, fee.fee_percent)}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                    aria-label={fee.label}
                    className={inputClass}
                  />
                  <span className="text-xs font-bold text-slate-500">%</span>
                  <button
                    onClick={() => saveFee(fee.category, fee.label, fee.fee_percent)}
                    disabled={!dirty || busyKey !== null}
                    className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-30"
                  >
                    {busyKey === key ? t("refreshing") : t("pricingSave")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[11px] text-slate-400">{t("pricingFeesNote")}</p>
      </section>

      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold text-slate-900">{t("pricingBoostsTitle")}</h3>
        <p className="mb-4 mt-1 text-xs text-slate-500">{t("pricingBoostsHint")}</p>
        <div className="space-y-5">
          {placements.map(([placement, placementLabel]) => (
            <div key={placement}>
              <p className="mb-1 text-xs font-black uppercase tracking-wider text-slate-500">{t.has(`pricingPlacement_${placement}`) ? t(`pricingPlacement_${placement}`) : placementLabel}</p>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                {data.boosts
                  .filter((b) => b.placement === placement)
                  .map((boost) => {
                    const key = boostKey(boost.placement, boost.duration_unit);
                    const dirty = isDirty(key, boost.price_xaf);
                    const label = `${placementLabel} / ${boost.unit_label}`;
                    return (
                      <li key={key} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800">{t.has(`pricingUnit_${boost.duration_unit}`) ? t(`pricingUnit_${boost.duration_unit}`) : boost.unit_label}</p>
                          {boost.price_xaf === null && <p className="text-[11px] text-slate-400">{t("pricingNotOffered")}</p>}
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={Number(data.max_boost_price_xaf)}
                            step="1"
                            value={draftOf(key, boost.price_xaf)}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                            aria-label={label}
                            placeholder="—"
                            className={`${inputClass} w-32`}
                          />
                          <span className="text-xs font-bold text-slate-500">XAF</span>
                          <button
                            onClick={() => saveBoost(boost.placement, boost.duration_unit, label, boost.price_xaf, false)}
                            disabled={!dirty || busyKey !== null}
                            className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-30"
                          >
                            {busyKey === key ? t("refreshing") : t("pricingSave")}
                          </button>
                          {boost.price_xaf !== null && (
                            <button
                              onClick={() => saveBoost(boost.placement, boost.duration_unit, label, boost.price_xaf, true)}
                              disabled={busyKey !== null}
                              className="rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-30"
                            >
                              {t("pricingRemove")}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
