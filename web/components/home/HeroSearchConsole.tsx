"use client";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import type { PopularQuarter, Quarter } from "@/lib/api";
import {
  IconSearch,
  IconMapPin,
  IconBuilding,
  IconHome,
  IconGraduationCap,
  IconHotel,
  IconSparkles,
} from "@/components/Icons";

interface HeroSearchConsoleProps {
  quarters: Quarter[];
  popularQuarters: PopularQuarter[];
}

export default function HeroSearchConsole({ quarters, popularQuarters }: HeroSearchConsoleProps) {
  const [activeTab, setActiveTab] = useState<"RENT" | "SALE" | "HOSTEL" | "HOTEL">("RENT");
  const [selectedQuarter, setSelectedQuarter] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [budgetTier, setBudgetTier] = useState("");

  const searchAction = activeTab === "HOSTEL" 
    ? "/student-hostels" 
    : activeTab === "HOTEL" 
    ? "/hotels" 
    : "/search";

  return (
    <div className="max-w-4xl mx-auto bg-white rounded-3xl p-4 sm:p-6 shadow-2xl shadow-black/40 border border-slate-100 text-left animate-rise-in">
      {/* Tab Selector */}
      <div className="flex items-center gap-1.5 sm:gap-2 mb-4 pb-3 border-b border-slate-100 overflow-x-auto text-xs sm:text-sm font-bold">
        <button
          type="button"
          onClick={() => setActiveTab("RENT")}
          className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all duration-200 ${
            activeTab === "RENT"
              ? "bg-slate-900 text-white shadow-md shadow-slate-900/20"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <IconHome size={16} />
          <span>For Rent</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("SALE")}
          className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all duration-200 ${
            activeTab === "SALE"
              ? "bg-slate-900 text-white shadow-md shadow-slate-900/20"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <IconBuilding size={16} />
          <span>Buy Property</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("HOSTEL")}
          className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all duration-200 ${
            activeTab === "HOSTEL"
              ? "bg-indigo-900 text-white shadow-md shadow-indigo-900/20"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <IconGraduationCap size={16} />
          <span>Student Hostels</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("HOTEL")}
          className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all duration-200 ${
            activeTab === "HOTEL"
              ? "bg-amber-900 text-white shadow-md shadow-amber-900/20"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <IconHotel size={16} />
          <span>Hotels &amp; Stays</span>
        </button>
      </div>

      {/* Dynamic Search Form */}
      <form action={searchAction} method="GET" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {activeTab !== "HOSTEL" && activeTab !== "HOTEL" && (
          <input type="hidden" name="listing_type" value={activeTab} />
        )}

        {/* Location Dropdown */}
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Neighborhood / City
          </label>
          <div className="relative flex items-center">
            <IconMapPin size={16} className="absolute left-3 text-slate-400 pointer-events-none" />
            <select
              name="quarter"
              value={selectedQuarter}
              onChange={(e) => setSelectedQuarter(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-xs sm:text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 appearance-none"
            >
              <option value="">All Areas in Cameroon</option>
              {Object.entries(
                quarters.reduce<Record<string, Quarter[]>>((groups, q) => {
                  (groups[q.region_name || "Other"] ??= []).push(q);
                  return groups;
                }, {})
              )
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([region, regionQuarters]) => (
                  <optgroup key={region} label={region}>
                    {regionQuarters.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.name} ({q.village_name})
                      </option>
                    ))}
                  </optgroup>
                ))}
            </select>
          </div>
        </div>

        {/* Property Type / Category */}
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            {activeTab === "HOSTEL" ? "Room Type" : activeTab === "HOTEL" ? "Suite Type" : "Property Type"}
          </label>
          <div className="relative flex items-center">
            <IconBuilding size={16} className="absolute left-3 text-slate-400 pointer-events-none" />
            <select
              name="property_type"
              value={propertyType}
              onChange={(e) => setPropertyType(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-xs sm:text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 appearance-none"
            >
              {activeTab === "HOSTEL" ? (
                <>
                  <option value="">Any Layout</option>
                  <option value="STUDIO">Single Studio Self-Contain</option>
                  <option value="BLOCK">Modern Room Block</option>
                  <option value="COMPOUND">Gated Campus Compound</option>
                </>
              ) : activeTab === "HOTEL" ? (
                <>
                  <option value="">Any Room Category</option>
                  <option value="SUITE">Executive Suite</option>
                  <option value="DELUXE">Deluxe Room</option>
                  <option value="STANDARD">Standard Room</option>
                </>
              ) : (
                <>
                  <option value="">Any Property Type</option>
                  <option value="HOUSE">House / Villa</option>
                  <option value="APARTMENT">Apartment / Flat</option>
                  <option value="LAND">Titled Land / Plot</option>
                  <option value="SHOP">Commercial Shop</option>
                </>
              )}
            </select>
          </div>
        </div>

        {/* Budget Filter */}
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Budget Range (XAF)
          </label>
          <div className="relative flex items-center">
            <IconSparkles size={16} className="absolute left-3 text-slate-400 pointer-events-none" />
            <select
              value={budgetTier}
              onChange={(e) => setBudgetTier(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-xs sm:text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 appearance-none"
            >
              <option value="">Any Budget</option>
              <option value="budget">Under 100,000 XAF</option>
              <option value="mid">100,000 – 300,000 XAF</option>
              <option value="prime">300,000 – 750,000 XAF</option>
              <option value="luxury">750,000+ XAF</option>
            </select>
          </div>
        </div>

        {/* Search Submit */}
        <div className="flex items-end">
          <button
            type="submit"
            className="w-full gold-gradient text-[var(--navy)] font-bold text-sm py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-amber-500/25 transition-all duration-200 active:scale-[0.98]"
          >
            <IconSearch size={16} className="stroke-[2.5]" />
            <span>
              {activeTab === "HOSTEL"
                ? "Find Hostels"
                : activeTab === "HOTEL"
                ? "Check Rooms"
                : "Search Properties"}
            </span>
          </button>
        </div>
      </form>

      {/* Quick Interactive Tags */}
      {popularQuarters.length > 0 && (
        <div className="mt-3.5 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">Quick Filters:</span>
          {popularQuarters.slice(0, 5).map((q) => (
            <Link
              key={q.id}
              href={`/search?quarter=${q.id}`}
              className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-amber-50 hover:text-amber-800 transition-colors"
            >
              {q.name} ({q.area})
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
