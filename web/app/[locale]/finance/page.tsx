"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { listQuarters, estimatePropertyValue, estimateAffordability, type Quarter, type ValuationEstimateResult, type AffordabilityResult } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";

type Tool = "valuation" | "affordability";

/**
 * Finance — the real gap this closes: estimate_property_value() and
 * estimate_affordable_rent_range() had real, working logic and even
 * a real model to store valuation results in, but no page anywhere
 * ever exposed either one. Both tools are public — neither requires
 * an account, matching how every other browse/search surface on the
 * platform works. Both use a simple, transparent formula (stated
 * plainly on the page itself) rather than a black-box estimate.
 */
export default function FinancePage() {
  const t = useTranslations("FinancePage");
  const [tool, setTool] = useState<Tool>("valuation");
  const [quarters, setQuarters] = useState<Quarter[]>([]);

  const [quarterId, setQuarterId] = useState("");
  const [propertyType, setPropertyType] = useState("HOUSE");
  const [valuationResult, setValuationResult] = useState<ValuationEstimateResult | null>(null);
  const [valuationLoading, setValuationLoading] = useState(false);
  const [valuationError, setValuationError] = useState("");

  const [monthlyIncome, setMonthlyIncome] = useState("");
  const [affordabilityResult, setAffordabilityResult] = useState<AffordabilityResult | null>(null);
  const [affordabilityLoading, setAffordabilityLoading] = useState(false);
  const [affordabilityError, setAffordabilityError] = useState("");

  useEffect(() => {
    listQuarters().then((data) => {
      setQuarters(data);
      if (data.length > 0) setQuarterId(data[0].id);
    }).catch(() => {});
  }, []);

  async function handleValuation(e: React.FormEvent) {
    e.preventDefault();
    setValuationLoading(true);
    setValuationError("");
    setValuationResult(null);
    try {
      const result = await estimatePropertyValue(quarterId, propertyType);
      setValuationResult(result);
    } catch (err) {
      setValuationError(err instanceof Error ? err.message : t("estimateFailed"));
    } finally {
      setValuationLoading(false);
    }
  }

  async function handleAffordability(e: React.FormEvent) {
    e.preventDefault();
    setAffordabilityLoading(true);
    setAffordabilityError("");
    setAffordabilityResult(null);
    try {
      const result = await estimateAffordability(monthlyIncome);
      setAffordabilityResult(result);
    } catch (err) {
      setAffordabilityError(err instanceof Error ? err.message : t("estimateFailed"));
    } finally {
      setAffordabilityLoading(false);
    }
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="flex gap-2 mb-6">
        {(["valuation", "affordability"] as const).map((key) => (
          <button
            key={key} onClick={() => setTool(key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tool === key ? "bg-[var(--navy)] text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
          >
            {key === "valuation" ? t("tabValuation") : t("tabAffordability")}
          </button>
        ))}
      </div>

      {tool === "valuation" ? (
        <div>
          <form onSubmit={handleValuation} className="border border-gray-200 rounded-xl p-6 bg-white mb-6 flex flex-col gap-3">
            <select value={quarterId} onChange={(e) => setQuarterId(e.target.value)} className="border rounded-lg px-3 py-2" required>
              {quarters.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select>
            <select value={propertyType} onChange={(e) => setPropertyType(e.target.value)} className="border rounded-lg px-3 py-2">
              <option value="HOUSE">{t("propertyTypeHouse")}</option>
              <option value="LAND">{t("propertyTypeLand")}</option>
              <option value="SHOP">{t("propertyTypeShop")}</option>
            </select>
            {valuationError && <p className="text-red-600 text-sm">{valuationError}</p>}
            <Button size="lg" disabled={valuationLoading}>{valuationLoading ? t("estimating") : t("getEstimate")}</Button>
          </form>

          {valuationResult && (
            <div className="border border-[var(--gold)] rounded-xl p-6 bg-white">
              <p className="text-sm text-gray-500 mb-2">{t("estimatedRangeFor", { quarter: valuationResult.quarter_name })}</p>
              <p className="text-2xl font-bold text-[var(--navy)] mb-2">
                {Number(valuationResult.estimated_low_xaf).toLocaleString()} – {Number(valuationResult.estimated_high_xaf).toLocaleString()} XAF
              </p>
              <p className="text-xs text-gray-500">
                {valuationResult.comparable_count === 1
                  ? t("basedOnComparables", { count: valuationResult.comparable_count })
                  : t("basedOnComparablesOther", { count: valuationResult.comparable_count })}
              </p>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-4">{t("valuationMethodNote")}</p>
        </div>
      ) : (
        <div>
          <form onSubmit={handleAffordability} className="border border-gray-200 rounded-xl p-6 bg-white mb-6 flex flex-col gap-3">
            <input
              required type="number" placeholder={t("monthlyIncomePlaceholder")} value={monthlyIncome}
              onChange={(e) => setMonthlyIncome(e.target.value)} className="border rounded-lg px-3 py-2"
            />
            {affordabilityError && <p className="text-red-600 text-sm">{affordabilityError}</p>}
            <Button size="lg" disabled={affordabilityLoading}>{affordabilityLoading ? t("estimating") : t("getEstimate")}</Button>
          </form>

          {affordabilityResult && (
            <div className="border border-[var(--gold)] rounded-xl p-6 bg-white flex flex-col gap-4">
              <div>
                <p className="text-sm text-gray-500 mb-1">{t("comfortableRent")}</p>
                <p className="text-xl font-bold text-[var(--navy)]">{Number(affordabilityResult.comfortable_rent_xaf).toLocaleString()} XAF</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">{t("maxRecommendedRent")}</p>
                <p className="text-xl font-bold text-[var(--navy)]">{Number(affordabilityResult.max_recommended_rent_xaf).toLocaleString()} XAF</p>
              </div>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-4">{t("affordabilityMethodNote")}</p>
        </div>
      )}
    </main>
  );
}
