"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import QuarterOptions from "@/components/QuarterOptions";
import {
  listWantedListings,
  createWantedListing,
  respondToWantedListing,
  listQuarters,
  type WantedListing,
  type Quarter,
} from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import {
  IconSearch,
  IconMapPin,
  IconShieldCheck,
  IconLock,
  IconClock,
  IconSparkles,
  IconBuilding,
  IconUsers,
} from "@/components/Icons";

const CATEGORY_LABEL_KEYS: Record<string, string> = {
  ROOM_RENTAL: "categoryRoom",
  STORE: "categoryStore",
  WAREHOUSE: "categoryWarehouse",
  BUSINESS: "categoryBusiness",
  BUSINESS_AREA: "categoryBusinessArea",
};

const CATEGORIES = [
  { value: "ROOM_RENTAL", labelKey: "categoryRoom" },
  { value: "STORE", labelKey: "categoryStore" },
  { value: "WAREHOUSE", labelKey: "categoryWarehouse" },
  { value: "BUSINESS", labelKey: "categoryBusiness" },
  { value: "BUSINESS_AREA", labelKey: "categoryBusinessArea" },
] as const;

const SHOWCASE_WANTED = [
  {
    id: "showcase-w1",
    category: "ROOM_RENTAL",
    quarter_name: "Bastos, Yaoundé",
    notes: "Expat family seeking 3-bedroom modern apartment or villa with private parking, backup water tank, and quiet environment.",
    max_budget_xaf: "350,000",
    min_size_sqm: 120,
    time_badge: "Urgent • Within 7 Days",
    created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: "showcase-w2",
    category: "ROOM_RENTAL",
    quarter_name: "Melen / Ngoa-Ekellé, Yaoundé",
    notes: "University student looking for single studio self-contain with prepaid light meter and running water. Ready to pay 1 year advance.",
    max_budget_xaf: "60,000",
    min_size_sqm: 25,
    time_badge: "Semester Start",
    created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
  {
    id: "showcase-w3",
    category: "STORE",
    quarter_name: "Akwa Boulevard, Douala",
    notes: "Retailer looking for a street-front commercial boutique for cosmetics and fashion. Must have heavy pedestrian traffic.",
    max_budget_xaf: "300,000",
    min_size_sqm: 45,
    time_badge: "High Footfall Required",
    created_at: new Date(Date.now() - 86400000 * 4).toISOString(),
  },
  {
    id: "showcase-w4",
    category: "WAREHOUSE",
    quarter_name: "Bonabéri / Magzi, Douala",
    notes: "Dry logistics distribution company seeking secure warehouse with easy semi-trailer truck access and high ceilings.",
    max_budget_xaf: "750,000",
    min_size_sqm: 400,
    time_badge: "Industrial Axis",
    created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
];

export default function WantedBoardPage() {
  const t = useTranslations("WantedBoardPage");
  const [listings, setListings] = useState<WantedListing[]>([]);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [showForm, setShowForm] = useState(false);

  // Filters
  const [filterCategory, setFilterCategory] = useState("");
  const [filterQuarter, setFilterQuarter] = useState("");

  // Form states
  const [category, setCategory] = useState<string>("ROOM_RENTAL");
  const [quarterId, setQuarterId] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [minSize, setMinSize] = useState("");
  const [notes, setNotes] = useState("");
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "error">("idle");

  // Response states
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [respondingToId, setRespondingToId] = useState<string | null>(null);
  const [replyMessage, setReplyMessage] = useState("");
  const [replyStatus, setReplyStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [replyError, setReplyError] = useState("");

  const load = useCallback(() => {
    if (typeof window !== "undefined" && localStorage.getItem("access_token")) {
      setIsLoggedIn(true);
    }
    listWantedListings()
      .then((data) => setListings(data.results))
      .catch(() => setListings([]))
      .finally(() => setStatus("ready"));
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
    listQuarters()
      .then((data) => {
        setQuarters(data);
      })
      .catch(() => {});
  }, [load]);

  async function handleSendReply(wantedId: string) {
    const token = localStorage.getItem("access_token");
    if (!token || !replyMessage.trim()) return;
    setReplyStatus("submitting");
    setReplyError("");
    try {
      await respondToWantedListing(wantedId, replyMessage.trim(), token);
      setReplyStatus("success");
      setReplyMessage("");
      setTimeout(() => {
        setRespondingToId(null);
        setReplyStatus("idle");
        load();
      }, 1500);
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Failed to submit response");
      setReplyStatus("error");
    }
  }

  const filteredListings = useMemo(() => {
    return listings.filter((item) => {
      if (filterCategory && item.category !== filterCategory) return false;
      if (filterQuarter && item.quarter !== filterQuarter) return false;
      return true;
    });
  }, [listings, filterCategory, filterQuarter]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) {
      window.location.href = "/login";
      return;
    }
    setSubmitStatus("submitting");
    try {
      await createWantedListing(
        {
          category,
          quarter: quarterId || undefined,
          max_budget_xaf: maxBudget ? Number(maxBudget) : undefined,
          min_size_sqm: minSize ? Number(minSize) : undefined,
          notes,
        },
        token
      );
      setShowForm(false);
      setNotes("");
      setMaxBudget("");
      setMinSize("");
      load();
    } catch {
      setSubmitStatus("error");
      return;
    }
    setSubmitStatus("idle");
  }

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 md:py-10">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <Button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 shadow-md shadow-amber-500/20"
          >
            <span>{showForm ? "Cancel" : `+ ${t("postRequest")}`}</span>
          </Button>
        }
      />

      {/* ================= WANTED BOARD ADVANTAGE ================= */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200/80 shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <IconUsers size={20} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Broadcast to 2,000+ Landlords</h4>
            <p className="text-xs text-slate-500 mt-0.5">Verified owners &amp; agents see your exact requirement</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200/80 shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <IconShieldCheck size={20} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Zero Rogue Inspection Fees</h4>
            <p className="text-xs text-slate-500 mt-0.5">Holders match your budget before you ever step out</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200/80 shadow-sm">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <IconLock size={20} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">100% Free for Seekers</h4>
            <p className="text-xs text-slate-500 mt-0.5">Post your demand for free; escrow protects your deal</p>
          </div>
        </div>
      </div>

      {/* ================= FILTER BAR ================= */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-sm mb-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
              Filter by Request Type
            </label>
            <div className="relative flex items-center">
              <IconBuilding size={16} className="absolute left-3 text-slate-400 pointer-events-none" />
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs sm:text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              >
                <option value="">All Categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {t(c.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
              Target Quarter
            </label>
            <div className="relative flex items-center">
              <IconMapPin size={16} className="absolute left-3 text-slate-400 pointer-events-none" />
              <select
                value={filterQuarter}
                onChange={(e) => setFilterQuarter(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs sm:text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              >
                <option value="">All Quarters</option>
                <QuarterOptions quarters={quarters} />
              </select>
            </div>
          </div>

          <div>
            <button
              onClick={() => {
                setFilterCategory("");
                setFilterQuarter("");
              }}
              className="w-full py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-600 transition-colors"
            >
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      {/* ================= ELEVATED POST REQUEST FORM ================= */}
      {showForm && (
        <div className="border border-slate-200/80 rounded-2xl p-6 sm:p-8 bg-white mb-10 shadow-xl shadow-slate-200/50 animate-rise-in">
          <div className="flex items-center gap-2 mb-6 pb-4 border-b border-slate-100">
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center font-bold text-sm">
              🔍
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-lg">Broadcast a Property Request</h3>
              <p className="text-xs text-slate-500">
                Describe what you need. Registered landlords and agents in Cameroon will reach out with matching properties.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Category <span className="text-red-500">*</span>
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                required
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {t(c.labelKey)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Preferred Quarter / City
              </label>
              <select
                value={quarterId}
                onChange={(e) => setQuarterId(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              >
                <option value="">Any Quarter</option>
                <QuarterOptions quarters={quarters} />
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Maximum Budget in XAF
              </label>
              <input
                type="number"
                placeholder="e.g. 150000"
                value={maxBudget}
                onChange={(e) => setMaxBudget(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Minimum Size (m², optional)
              </label>
              <input
                type="number"
                placeholder="e.g. 50"
                value={minSize}
                onChange={(e) => setMinSize(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Detailed Notes &amp; Specifications <span className="text-red-500">*</span>
              </label>
              <textarea
                required
                rows={3}
                placeholder="Tell property owners your specific needs (e.g. 2 bedrooms, borehole water, street-facing shop, move-in by next week)..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>

            {submitStatus === "error" && (
              <p className="text-red-600 text-xs md:col-span-2 font-medium">
                Could not post request. Please make sure you are signed in.
              </p>
            )}

            <div className="md:col-span-2 flex gap-3 pt-2">
              <Button disabled={submitStatus === "submitting"} className="flex-1" size="lg">
                {submitStatus === "submitting" ? "Publishing..." : "Publish Wanted Request"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)} size="lg">
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* ================= LISTINGS DISPLAY ================= */}
      {status === "loading" ? (
        <div className="py-20 text-center text-slate-400">Loading requests...</div>
      ) : listings.length > 0 ? (
        /* Real live listings from the backend */
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-slate-900 text-lg">
              {filteredListings.length} {filteredListings.length === 1 ? "Open Request" : "Open Requests"}
            </h3>
          </div>

          {filteredListings.map((item) => (
            <div
              key={item.id}
              className="border border-slate-200/80 rounded-2xl p-5 sm:p-6 bg-white shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Badge variant="navy">{t(CATEGORY_LABEL_KEYS[item.category] || "categoryRoom")}</Badge>
                  {item.quarter_name && (
                    <span className="text-xs font-medium text-slate-600 flex items-center gap-1">
                      <IconMapPin size={13} className="text-amber-500" />
                      <span>{item.quarter_name}</span>
                    </span>
                  )}
                </div>
                <span className="text-xs text-slate-400">
                  {t("postedOn", { date: new Date(item.created_at).toLocaleDateString() })}
                </span>
              </div>

              <p className="text-slate-800 text-sm leading-relaxed mb-4">{item.notes}</p>

              <div className="flex flex-wrap items-center justify-between gap-4 text-xs font-semibold text-slate-700 pt-3 border-t border-slate-100">
                <div className="flex flex-wrap items-center gap-2">
                  {item.max_budget_xaf && (
                    <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                      💰 {t("budgetUpTo", { amount: Number(item.max_budget_xaf).toLocaleString() })}
                    </span>
                  )}
                  {item.min_size_sqm && (
                    <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700">
                      📐 {t("sizeAtLeast", { size: item.min_size_sqm })}
                    </span>
                  )}
                  {item.responses && item.responses.length > 0 && (
                    <span className="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 font-bold">
                      💬 {item.responses.length} {item.responses.length === 1 ? "offer" : "offers"}
                    </span>
                  )}
                </div>

                {isLoggedIn ? (
                  <button
                    type="button"
                    onClick={() => {
                      setRespondingToId(respondingToId === item.id ? null : item.id);
                      setReplyError("");
                    }}
                    className="ml-auto text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 hover:bg-amber-300 transition-colors shadow-2xs cursor-pointer"
                  >
                    {respondingToId === item.id ? "Cancel Response" : "Respond with Match →"}
                  </button>
                ) : (
                  <Link
                    href="/login"
                    className="ml-auto text-xs font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1"
                  >
                    <span>{t("signInToRespond")}</span>
                    <span>→</span>
                  </Link>
                )}
              </div>

              {respondingToId === item.id && (
                <div className="mt-3 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2 animate-in fade-in">
                  <label className="text-xs font-bold text-slate-800 block">
                    Your Offer / Matching Property Note:
                  </label>
                  <textarea
                    rows={2}
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    placeholder="Describe your matching property, price, and quarter (e.g. I have a 2-bedroom apartment in Bastos available at 180,000 XAF)..."
                    className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400"
                  />
                  {replyError && <p className="text-xs text-rose-600">{replyError}</p>}
                  {replyStatus === "success" && <p className="text-xs text-emerald-600 font-bold">✓ Offer sent successfully to the seeker!</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={replyStatus === "submitting" || !replyMessage.trim()}
                      onClick={() => handleSendReply(item.id)}
                      className="px-4 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {replyStatus === "submitting" ? "Sending..." : "Submit Match Offer"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRespondingToId(null)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-200"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        /* Professional Showcase Requests when Database is empty */
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[11px] font-bold uppercase tracking-wider text-amber-800 mb-1">
                <IconSparkles size={12} />
                <span>Live Demand Broadcast Preview</span>
              </div>
              <h3 className="font-[family-name:var(--font-display)] text-xl font-bold text-slate-900">
                Active Tenant &amp; Commercial Seeker Requests in Cameroon
              </h3>
            </div>
            <p className="text-xs text-slate-500 max-w-xs">
              Direct connection between serious searchers and verified property owners.
            </p>
          </div>

          <div className="space-y-4 mb-10">
            {SHOWCASE_WANTED.map((item) => (
              <div
                key={item.id}
                className="border border-slate-200/80 rounded-2xl p-5 sm:p-6 bg-white shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Badge variant="navy">{t(CATEGORY_LABEL_KEYS[item.category] || "categoryRoom")}</Badge>
                    <span className="text-xs font-medium text-slate-600 flex items-center gap-1">
                      <IconMapPin size={13} className="text-amber-500" />
                      <span>{item.quarter_name}</span>
                    </span>
                    <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
                      {item.time_badge}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    {t("postedOn", { date: new Date(item.created_at).toLocaleDateString() })}
                  </span>
                </div>

                <p className="text-slate-800 text-sm leading-relaxed mb-4">{item.notes}</p>

                <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-700 pt-3 border-t border-slate-100">
                  <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                    💰 {t("budgetUpTo", { amount: Number(item.max_budget_xaf).toLocaleString() })}
                  </span>
                  <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700">
                    📐 {t("sizeAtLeast", { size: item.min_size_sqm })}
                  </span>
                  <button
                    onClick={() => setShowForm(true)}
                    className="ml-auto text-xs font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1"
                  >
                    <span>Post a Match or Similar Request</span>
                    <span>→</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="p-6 rounded-2xl bg-gradient-to-r from-amber-950 via-slate-900 to-slate-900 text-white flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h4 className="font-bold text-base">Can’t Find What You’re Looking For?</h4>
              <p className="text-xs text-slate-300 mt-1">
                Post your exact property or space requirement. Verified Cameroonian landlords and licensed agents will contact you directly.
              </p>
            </div>
            <Button onClick={() => setShowForm(true)} className="whitespace-nowrap shrink-0">
              {t("postRequest")}
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
