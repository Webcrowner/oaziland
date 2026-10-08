"use client";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { IconSparkles, IconShieldCheck, IconSearch } from "@/components/Icons";
import { searchListings } from "@/lib/api";

const MIN_INCOME = 50000;
const MAX_INCOME = 2000000;

export default function InteractiveAffordabilityCalculator() {
  const [income, setIncome] = useState<number>(300000);
  const [ratio, setRatio] = useState<number>(0.30); // 30% guideline
  const [live, setLive] = useState<{ count: number; quarters: string[] } | null | undefined>(undefined);

  const maxRent = Math.round(income * ratio);
  const annualBudget = maxRent * 12;

  // Real, live rentals within the computed ceiling (debounced so dragging the slider doesn't spam the API).
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      searchListings({ listing_type: "RENT", max_price: String(maxRent) })
        .then((data) => {
          if (cancelled) return;
          const quarters = [...new Set(data.results.map((l) => l.property_asset.quarter_name).filter(Boolean))];
          setLive({ count: data.count, quarters });
        })
        .catch(() => {
          if (!cancelled) setLive(null);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [maxRent]);

  // Typical-neighbourhood guide, used when no live listing data is available for this budget.
  const guideAreas = maxRent < 80000
    ? ["Molyko (Buea)", "Melen (Yaoundé)", "Ngoa-Ekellé (Yaoundé)", "PK14 (Douala)"]
    : maxRent < 200000
    ? ["Biyem-Assi (Yaoundé)", "Makepe (Douala)", "Logpom (Douala)", "Odza (Yaoundé)"]
    : maxRent < 450000
    ? ["Bonapriso (Douala)", "Bastos (Yaoundé)", "Kribi Beachfront", "Santa Barbara (Yaoundé)"]
    : ["Bastos Diplomatic (Yaoundé)", "Bonanjo Executive (Douala)", "Golf Course Villas (Yaoundé)"];
  const suggestedAreas = live && live.quarters.length > 0 ? live.quarters.slice(0, 4) : guideAreas;

  return (
    <section className="py-16 sm:py-20 px-4 sm:px-6 bg-slate-900 text-white relative overflow-hidden">
      <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-5xl mx-auto relative z-10">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-[11px] font-bold uppercase tracking-wider text-amber-300 mb-2.5">
            <IconSparkles size={13} className="text-amber-400" />
            <span>Cameroon Financial Planning Tool</span>
          </div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-bold mb-2">
            Calculate Your Safe Rent Budget
          </h2>
          <p className="text-slate-300 text-xs sm:text-sm">
            Based on the proven 25%–30% income rule to protect your savings and avoid lease distress.
          </p>
        </div>

        <div className="bg-slate-800/80 rounded-3xl p-6 sm:p-8 border border-slate-700/80 shadow-2xl backdrop-blur-md grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
          {/* Controls */}
          <div className="space-y-6">
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Your Net Monthly Household Income
                </label>
                <span className="text-base sm:text-lg font-extrabold text-amber-400">
                  {income.toLocaleString()} XAF
                </span>
              </div>
              <input
                type="range"
                min={MIN_INCOME}
                max={MAX_INCOME}
                step={25000}
                value={income}
                onChange={(e) => setIncome(Number(e.target.value))}
                className="w-full accent-amber-400 cursor-pointer h-2 bg-slate-700 rounded-lg"
              />
              <div className="flex justify-between text-[11px] text-slate-400 mt-1 font-medium">
                <span>50,000 XAF</span>
                <span>1,000,000 XAF</span>
                <span>2,000,000+ XAF</span>
              </div>
            </div>

            {/* Income ratio toggle */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
                Budget Prudence Guideline
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setRatio(0.25)}
                  className={`py-2 px-3 rounded-xl border transition-all ${
                    ratio === 0.25
                      ? "bg-amber-400 text-slate-950 border-amber-400"
                      : "bg-slate-700/60 text-slate-300 border-slate-600 hover:bg-slate-700"
                  }`}
                >
                  Conservative (25% of income)
                </button>
                <button
                  type="button"
                  onClick={() => setRatio(0.30)}
                  className={`py-2 px-3 rounded-xl border transition-all ${
                    ratio === 0.30
                      ? "bg-amber-400 text-slate-950 border-amber-400"
                      : "bg-slate-700/60 text-slate-300 border-slate-600 hover:bg-slate-700"
                  }`}
                >
                  Standard (30% of income)
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
              <IconShieldCheck size={16} className="text-emerald-400 shrink-0" />
              <span>MoMo escrow protects you from paying upfront before landlord keys handover.</span>
            </div>
          </div>

          {/* Results Card */}
          <div className="bg-slate-900/90 rounded-2xl p-6 border border-slate-700/90 flex flex-col justify-between space-y-5">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 block mb-1">
                Recommended Monthly Ceiling
              </span>
              <p className="text-3xl sm:text-4xl font-black text-white tracking-tight">
                {maxRent.toLocaleString()} <span className="text-xs font-medium text-slate-400">XAF / month</span>
              </p>
              <p className="text-xs text-slate-400 mt-1 font-medium">
                Annual commitment: ~{annualBudget.toLocaleString()} XAF
              </p>
              <p className="text-xs font-bold text-emerald-400 mt-2" aria-live="polite">
                {live === undefined
                  ? "Checking live rentals…"
                  : live === null
                  ? ""
                  : live.count === 0
                  ? "No live rentals within this budget yet"
                  : `${live.count.toLocaleString()} live rental${live.count === 1 ? "" : "s"} within this budget`}
              </p>
            </div>

            <div className="pt-4 border-t border-slate-800">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
                {live && live.quarters.length > 0 ? "Quarters With Rentals In Your Budget:" : "Ideal Matching Quarters in Cameroon:"}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {suggestedAreas.map((area) => (
                  <span
                    key={area}
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-white/10 text-amber-300 border border-white/10"
                  >
                    📍 {area}
                  </span>
                ))}
              </div>
            </div>

            <Link
              href={`/search?listing_type=RENT&max_price=${maxRent}`}
              className="gold-gradient text-[var(--navy)] text-xs sm:text-sm font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-amber-500/25 transition-transform active:scale-95 text-center"
            >
              <IconSearch size={16} className="stroke-[2.5]" />
              <span>Browse Properties Within My Budget</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
