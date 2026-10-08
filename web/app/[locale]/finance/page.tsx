"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { listQuarters, estimatePropertyValue, estimateAffordability, convertCurrency, getMyEarningsReport, type Quarter, type ValuationEstimateResult, type AffordabilityResult, type EarningsReportResult } from "@/lib/api";
import QuarterOptions from "@/components/QuarterOptions";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";

type Tool = "valuation" | "affordability" | "currency" | "earnings";

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

  const [currencyAmount, setCurrencyAmount] = useState("");
  const [currencyCode, setCurrencyCode] = useState("USD");
  const [currencyResult, setCurrencyResult] = useState<string | null>(null);
  const [currencyLoading, setCurrencyLoading] = useState(false);
  const [currencyError, setCurrencyError] = useState("");

  const [earningsStart, setEarningsStart] = useState("");
  const [earningsEnd, setEarningsEnd] = useState("");
  const [earningsResult, setEarningsResult] = useState<EarningsReportResult | null>(null);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [earningsError, setEarningsError] = useState("");

  useEffect(() => {
    listQuarters().then((data) => {
      setQuarters(data);
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

  async function handleConvertCurrency(e: React.FormEvent) {
    e.preventDefault();
    setCurrencyLoading(true);
    setCurrencyError("");
    setCurrencyResult(null);
    try {
      const result = await convertCurrency(currencyAmount, currencyCode);
      setCurrencyResult(result.converted_amount);
    } catch (err) {
      setCurrencyError(err instanceof Error ? err.message : t("estimateFailed"));
    } finally {
      setCurrencyLoading(false);
    }
  }

  async function handleGenerateEarnings(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setEarningsLoading(true);
    setEarningsError("");
    setEarningsResult(null);
    try {
      const result = await getMyEarningsReport(earningsStart, earningsEnd, token);
      setEarningsResult(result);
    } catch (err) {
      setEarningsError(err instanceof Error ? err.message : t("estimateFailed"));
    } finally {
      setEarningsLoading(false);
    }
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="flex gap-2 mb-6 flex-wrap">
        {(["valuation", "affordability", "currency", "earnings"] as const).map((key) => (
          <button
            key={key} onClick={() => setTool(key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tool === key ? "bg-[var(--navy)] text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
          >
            {key === "valuation" ? t("tabValuation") : key === "affordability" ? t("tabAffordability") : key === "currency" ? t("tabCurrency") : t("tabEarnings")}
          </button>
        ))}
      </div>

      {tool === "valuation" ? (
        <div>
          <form onSubmit={handleValuation} className="border border-gray-200 rounded-xl p-6 bg-white mb-6 flex flex-col gap-3">
            <select value={quarterId} onChange={(e) => setQuarterId(e.target.value)} className="border rounded-lg px-3 py-2" required>
              <option value="" disabled>Choose a neighborhood…</option>
              <QuarterOptions quarters={quarters} />
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
      ) : tool === "affordability" ? (
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
      ) : tool === "currency" ? (
        <div>
          <form onSubmit={handleConvertCurrency} className="border border-gray-200 rounded-xl p-6 bg-white mb-6 flex flex-col gap-3">
            <input
              required type="number" placeholder={t("currencyAmountPlaceholder")} value={currencyAmount}
              onChange={(e) => setCurrencyAmount(e.target.value)} className="border rounded-lg px-3 py-2"
            />
            <input
              required placeholder={t("currencyCodePlaceholder")} value={currencyCode}
              onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())} className="border rounded-lg px-3 py-2"
            />
            {currencyError && <p className="text-red-600 text-sm">{currencyError}</p>}
            <Button size="lg" disabled={currencyLoading}>{currencyLoading ? t("converting") : t("convert")}</Button>
          </form>
          {currencyResult && (
            <div className="border border-[var(--gold)] rounded-xl p-6 bg-white">
              <p className="text-2xl font-bold text-[var(--navy)]">{t("conversionResult", { amount: Number(currencyResult).toLocaleString(), currency: currencyCode })}</p>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-4">{t("conversionNote")}</p>
        </div>
      ) : (
        <div>
          <form onSubmit={handleGenerateEarnings} className="border border-gray-200 rounded-xl p-6 bg-white mb-6 flex flex-col gap-3">
            <p className="text-xs text-gray-500">{t("signInForEarnings")}</p>
            <div className="grid grid-cols-2 gap-3">
              <input required type="date" placeholder={t("startDatePlaceholder")} value={earningsStart} onChange={(e) => setEarningsStart(e.target.value)} className="border rounded-lg px-3 py-2" />
              <input required type="date" placeholder={t("endDatePlaceholder")} value={earningsEnd} onChange={(e) => setEarningsEnd(e.target.value)} className="border rounded-lg px-3 py-2" />
            </div>
            {earningsError && <p className="text-red-600 text-sm">{earningsError}</p>}
            <Button size="lg" disabled={earningsLoading}>{earningsLoading ? t("generatingReport") : t("generateReport")}</Button>
          </form>
          {earningsResult && (
            <div className="border border-[var(--gold)] rounded-xl p-6 bg-white flex flex-col gap-4">
              <div>
                <p className="text-sm text-gray-500 mb-1">{t("totalCommissionEarned")}</p>
                <p className="text-xl font-bold text-[var(--navy)]">{Number(earningsResult.total_commission_earned_xaf).toLocaleString()} XAF</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">{t("totalPayoutsReceived")}</p>
                <p className="text-xl font-bold text-[var(--navy)]">{Number(earningsResult.total_payouts_received_xaf).toLocaleString()} XAF</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">{t("transactionCount")}</p>
                <p className="text-xl font-bold text-[var(--navy)]">{earningsResult.transaction_count}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
