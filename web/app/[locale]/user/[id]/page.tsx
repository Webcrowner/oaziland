"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { Link } from "@/i18n/navigation";

function MapLoading() {
  const t = useTranslations("UserPortfolio");
  return (
    <div className="w-full h-64 bg-slate-100 animate-pulse rounded-2xl flex items-center justify-center text-xs text-slate-400">
      {t("mapLoading")}
    </div>
  );
}

// Dynamic Leaflet map without SSR
const PropertyMap = dynamic(() => import("@/components/PropertyMap"), {
  ssr: false,
  loading: () => <MapLoading />,
});
import {
  getUserPublicIndex,
  type UserRoleIndexProfile,
  type UserRoleIndexHotel,
  type UserRoleIndexHostel,
  type UserRoleIndexListing,
} from "@/lib/api";
import RateAndReport from "@/components/RateAndReport";
import FollowButton from "@/components/FollowButton";
import DirectChatButton from "@/components/DirectChatButton";
import Avatar from "@/components/Avatar";
import ShareAndQrModal from "@/components/ShareAndQrModal";
import {
  IconHotel,
  IconGraduationCap,
  IconBuilding,
  IconHome,
  IconMapPin,
  IconStar,
  IconShieldCheck,
  IconShare,
  IconQrCode,
  IconCompass,
  IconBriefcase,
  IconLayers,
  IconWrench,
  IconCar,
  IconCheckCircle,
} from "@/components/Icons";

export default function UserPublicIndexPage() {
  const params = useParams();
  const userId = params?.id as string;
  const t = useTranslations("UserPortfolio");
  const locale = useLocale();

  const [profile, setProfile] = useState<UserRoleIndexProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "hotels" | "hostels" | "apartments" | "all_listings" | "map" | "technician" | "driver">("all");

  const [pageUrl, setPageUrl] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      void Promise.resolve().then(() => setPageUrl(window.location.href));
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    void Promise.resolve().then(() => setLoading(true));
    getUserPublicIndex(userId)
      .then((data) => {
        setProfile(data);
        // Set initial smart tab based on what's available
        if (data.hotels.length > 0 && data.hostels.length === 0 && data.listings.length === 0) {
          setActiveTab("hotels");
        } else if (data.hostels.length > 0 && data.hotels.length === 0 && data.listings.length === 0) {
          setActiveTab("hostels");
        }
        setError(null);
      })
      .catch((err) => {
        setError(err.message || t("loadFailed"));
      })
      .finally(() => setLoading(false));
  }, [userId, t]);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto text-center py-24">
          <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500 font-medium text-sm">{t("loading")}</p>
        </div>
      </main>
    );
  }

  if (error || !profile) {
    return (
      <main className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6">
        <div className="max-w-md mx-auto bg-white rounded-3xl p-8 border border-slate-200 text-center shadow-xs">
          <div className="w-12 h-12 bg-rose-50 text-rose-500 rounded-2xl flex items-center justify-center mx-auto mb-4 font-bold text-xl">
            !
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">{t("notFound")}</h2>
          <p className="text-sm text-slate-500 mb-6">{error || t("notFoundBody")}</p>
          <Link
            href="/search"
            className="inline-block px-5 py-2.5 rounded-xl font-bold text-xs bg-slate-900 text-white hover:bg-slate-800 transition-colors"
          >
            {t("explore")}
          </Link>
        </div>
      </main>
    );
  }

  const roleLabels: Record<string, string> = {
    hotel_owner: t("role_hotel_owner"),
    hostel_owner: t("role_hostel_owner"),
    landlord: t("role_landlord"),
    agent: t("role_agent"),
    agency: t("role_agency"),
    technician: t("role_technician"),
    driver: t("role_driver"),
    student: t("role_student"),
    user: t("role_user"),
  };

  const apartments = profile.listings.filter(
    (l) => l.property_type === "HOUSE" && ["APARTMENT", "STUDIO", "ROOM", "SELF_CONTAIN"].includes(l.house_style)
  );

  // All geo-located properties for the map view & tracking
  const geoProperties: {
    id: string;
    title: string;
    category: string;
    latitude: number;
    longitude: number;
    quarter_name: string;
    url: string;
  }[] = [];

  profile.hotels.forEach((h) => {
    if (h.latitude && h.longitude) {
      geoProperties.push({
        id: h.id,
        title: h.name || t("hotelIn", { place: h.quarter_name }),
        category: t("catHotel"),
        latitude: h.latitude,
        longitude: h.longitude,
        quarter_name: h.quarter_name,
        url: `/hotels/${h.id}`,
      });
    }
  });

  profile.hostels.forEach((sh) => {
    if (sh.latitude && sh.longitude) {
      geoProperties.push({
        id: sh.id,
        title: sh.name || t("hostelIn", { place: sh.quarter_name }),
        category: t("catHostel"),
        latitude: sh.latitude,
        longitude: sh.longitude,
        quarter_name: sh.quarter_name,
        url: `/student-hostels/${sh.id}`,
      });
    }
  });

  profile.guest_houses.forEach((gh) => {
    if (gh.latitude && gh.longitude) {
      geoProperties.push({
        id: gh.id,
        title: t("guestHouseIn", { place: gh.quarter_name }),
        category: t("catGuestHouse"),
        latitude: gh.latitude,
        longitude: gh.longitude,
        quarter_name: gh.quarter_name,
        url: "/guest-houses",
      });
    }
  });

  profile.venues.forEach((v) => {
    if (v.latitude && v.longitude) {
      geoProperties.push({
        id: v.id,
        title: t("venueIn", { place: v.quarter_name }),
        category: t("catVenue"),
        latitude: v.latitude,
        longitude: v.longitude,
        quarter_name: v.quarter_name,
        url: "/events",
      });
    }
  });

  profile.listings.forEach((l) => {
    if (l.latitude && l.longitude) {
      geoProperties.push({
        id: l.id,
        title: l.title,
        category: l.house_style || l.property_type,
        latitude: l.latitude,
        longitude: l.longitude,
        quarter_name: l.quarter_name,
        url: `/listing/${l.id}`,
      });
    }
  });

  const hasAnyGps = geoProperties.length > 0;
  const totalOfferingsCount =
    profile.hotels.length + profile.hostels.length + profile.listings.length;

  return (
    <main className="min-h-screen bg-slate-50/70 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* ========================================================= */}
        {/* MOBILE-ONLY HEADER (< lg)                                  */}
        {/* ========================================================= */}
        <div className="md:hidden mb-6 space-y-4">
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs relative overflow-hidden">
            <div className="absolute top-0 right-0 w-60 h-60 bg-linear-to-br from-amber-400/10 to-indigo-500/5 rounded-full blur-2xl pointer-events-none" />

            <div className="flex items-center gap-4 relative">
              <Avatar
                src={profile.profile_image_url}
                name={profile.full_name}
                className="w-16 h-16 rounded-2xl bg-slate-900 text-amber-400 text-2xl font-black shadow-md border-2 border-slate-800"
              />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-extrabold text-slate-900 truncate">
                    {profile.full_name}
                  </h1>
                  {profile.is_kyc_verified && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <IconShieldCheck size={12} className="text-emerald-600" />
                      {t("kycVerified")}
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-500 font-mono mt-0.5">@{profile.username}</p>

                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {profile.roles.map((r) => {
                    const verifiedRole = profile.verified_roles?.includes(r);
                    return (
                      <span
                        key={r}
                        className={
                          verifiedRole
                            ? "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-700"
                        }
                      >
                        {verifiedRole && <IconShieldCheck size={11} className="text-emerald-600" />}
                        {roleLabels[r] || r}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 mt-4 pt-4 border-t border-slate-100">
              <DirectChatButton
                recipientId={userId}
                recipientName={profile.full_name}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-[var(--navy)] text-white hover:bg-slate-800 transition-all shadow-xs active:scale-98 cursor-pointer"
              />
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <FollowButton userId={userId} />
                </div>
                <button
                  type="button"
                  onClick={() => setShowShareModal(true)}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl font-bold text-xs bg-slate-900 text-amber-300 hover:bg-slate-800 transition-all shadow-xs active:scale-95 cursor-pointer shrink-0"
                >
                  <IconQrCode size={15} />
                  <IconShare size={14} />
                  <span>{t("shareShort")}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Mobile Horizontal Category Pills */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden">
            <button
              onClick={() => setActiveTab("all")}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                activeTab === "all"
                  ? "bg-slate-900 text-white shadow-xs"
                  : "bg-white text-slate-600 border border-slate-200/80 hover:bg-slate-50"
              }`}
            >
              {t("allCount", { count: totalOfferingsCount })}
            </button>

            {profile.hotels.length > 0 && (
              <button
                onClick={() => setActiveTab("hotels")}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer ${
                  activeTab === "hotels"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-white text-slate-600 border border-slate-200/80 hover:bg-slate-50"
                }`}
              >
                <IconHotel size={13} />
                <span>{t("pillHotels", { count: profile.hotels.length })}</span>
              </button>
            )}

            {profile.hostels.length > 0 && (
              <button
                onClick={() => setActiveTab("hostels")}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer ${
                  activeTab === "hostels"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-white text-slate-600 border border-slate-200/80 hover:bg-slate-50"
                }`}
              >
                <IconGraduationCap size={13} />
                <span>{t("pillHostels", { count: profile.hostels.length })}</span>
              </button>
            )}

            {apartments.length > 0 && (
              <button
                onClick={() => setActiveTab("apartments")}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer ${
                  activeTab === "apartments"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-white text-slate-600 border border-slate-200/80 hover:bg-slate-50"
                }`}
              >
                <IconBuilding size={13} />
                <span>{t("pillApartments", { count: apartments.length })}</span>
              </button>
            )}

            {profile.listings.length > 0 && (
              <button
                onClick={() => setActiveTab("all_listings")}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer ${
                  activeTab === "all_listings"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-white text-slate-600 border border-slate-200/80 hover:bg-slate-50"
                }`}
              >
                <IconLayers size={13} />
                <span>{t("pillProperties", { count: profile.listings.length })}</span>
              </button>
            )}

            {hasAnyGps && (
              <button
                onClick={() => setActiveTab("map")}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer ${
                  activeTab === "map"
                    ? "bg-amber-400 text-slate-950 shadow-xs"
                    : "bg-white text-slate-600 border border-slate-200/80 hover:bg-slate-50"
                }`}
              >
                <IconCompass size={13} className="text-amber-600" />
                <span>{t("pillMap", { count: geoProperties.length })}</span>
              </button>
            )}

            {profile.technician && (
              <button
                onClick={() => setActiveTab("technician")}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer ${
                  activeTab === "technician"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-white text-slate-600 border border-slate-200/80 hover:bg-slate-50"
                }`}
              >
                <IconWrench size={13} />
                <span>{t("pillServices")}</span>
              </button>
            )}

            {profile.driver && (
              <button
                onClick={() => setActiveTab("driver")}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer ${
                  activeTab === "driver"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-white text-slate-600 border border-slate-200/80 hover:bg-slate-50"
                }`}
              >
                <IconCar size={13} />
                <span>{t("pillFleet")}</span>
              </button>
            )}
          </div>
        </div>

        {/* ========================================================= */}
        {/* RESPONSIVE LAYOUT: DESKTOP SIDEBAR + MAIN CONTENT AREA     */}
        {/* ========================================================= */}
        <div className="md:flex md:gap-6 lg:gap-8 md:items-start">
          {/* ======================================================= */}
          {/* DESKTOP SIDEBAR (>= lg)                                 */}
          {/* ======================================================= */}
          <aside className="hidden md:flex md:flex-col md:w-64 lg:w-80 xl:w-88 shrink-0 sticky top-24 self-start space-y-5">
            {/* 1. Identity & Credibility Card */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200/90 shadow-xs relative overflow-hidden">
              <div className="h-1.5 bg-linear-to-r from-amber-400 via-indigo-500 to-emerald-400 absolute top-0 left-0 right-0" />

              <div className="flex items-start gap-4 mb-4">
                <Avatar
                  src={profile.profile_image_url}
                  name={profile.full_name}
                  className="w-16 h-16 rounded-2xl bg-slate-950 text-amber-400 text-2xl font-black shadow-md border-2 border-slate-800"
                />
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-black text-slate-900 tracking-tight leading-tight truncate">
                    {profile.full_name}
                  </h2>
                  <p className="text-xs text-slate-400 font-mono">@{profile.username}</p>

                  <div className="mt-1.5">
                    {profile.is_kyc_verified ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <IconShieldCheck size={13} className="text-emerald-600" />
                        {t("kycVerified")}
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                        {t("kycPending")}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Roles Badge List */}
              <div className="space-y-1.5 mb-4">
                <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                  {t("activeRoles")}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.roles.map((r) => (
                    <span
                      key={r}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wide bg-slate-100 text-slate-800 border border-slate-200/70"
                    >
                      {roleLabels[r] || r}
                    </span>
                  ))}
                </div>
                {profile.agency_name && (
                  <p className="text-xs text-slate-600 font-medium pt-1 flex items-center gap-1">
                    <IconBriefcase size={13} className="text-slate-400" />
                    <span>{t.rich("memberOf", { agency: profile.agency_name, strong: (chunks) => <strong>{chunks}</strong> })}</span>
                  </p>
                )}
              </div>

              {/* Ratings & Reviews */}
              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-100 mb-5 text-xs">
                <div>
                  <span className="text-slate-400 block text-[10px] font-bold uppercase">{t("reputation")}</span>
                  {profile.average_rating ? (
                    <div className="flex items-center gap-1 font-extrabold text-slate-900 mt-0.5">
                      <span className="text-amber-500">★</span>
                      <span>{profile.average_rating}</span>
                      <span className="text-slate-400 font-normal">
                        ({t("reviewCount", { count: profile.rating_count })})
                      </span>
                    </div>
                  ) : (
                    <span className="text-slate-500 font-medium">{t("newMember")}</span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-slate-400 block text-[10px] font-bold uppercase">{t("offerings")}</span>
                  <span className="font-extrabold text-slate-900">{t("listedCount", { count: totalOfferingsCount })}</span>
                </div>
              </div>

              {/* Primary Actions: Chat, Share & Follow */}
              <div className="space-y-2">
                <DirectChatButton
                  recipientId={userId}
                  recipientName={profile.full_name}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-[var(--navy)] text-white hover:bg-slate-800 transition-all shadow-sm active:scale-98 cursor-pointer"
                />

                <button
                  type="button"
                  onClick={() => setShowShareModal(true)}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-slate-950 text-amber-300 hover:bg-slate-900 transition-all shadow-sm active:scale-98 cursor-pointer"
                >
                  <IconQrCode size={16} />
                  <IconShare size={15} />
                  <span>{t("sharePortfolio")}</span>
                </button>

                <div className="w-full">
                  <FollowButton userId={userId} />
                </div>
              </div>
            </div>

            {/* 2. Role Navigation Menu Card */}
            <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-xs">
              <div className="px-3 py-2 mb-1">
                <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                  {t("navTitle")}
                </p>
              </div>

              <nav className="space-y-1">
                <button
                  type="button"
                  onClick={() => setActiveTab("all")}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all text-left cursor-pointer ${
                    activeTab === "all"
                      ? "bg-slate-900 text-white shadow-xs"
                      : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <IconLayers size={16} className={activeTab === "all" ? "text-amber-400" : "text-slate-400"} />
                    <span>{t("navAll")}</span>
                  </div>
                  <span
                    className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                      activeTab === "all" ? "bg-amber-400 text-slate-950" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {totalOfferingsCount}
                  </span>
                </button>

                {profile.hotels.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("hotels")}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all text-left cursor-pointer ${
                      activeTab === "hotels"
                        ? "bg-slate-900 text-white shadow-xs"
                        : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <IconHotel size={16} className={activeTab === "hotels" ? "text-amber-400" : "text-slate-400"} />
                      <span>{t("navHotels")}</span>
                    </div>
                    <span
                      className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                        activeTab === "hotels" ? "bg-amber-400 text-slate-950" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {profile.hotels.length}
                    </span>
                  </button>
                )}

                {profile.hostels.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("hostels")}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all text-left cursor-pointer ${
                      activeTab === "hostels"
                        ? "bg-slate-900 text-white shadow-xs"
                        : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <IconGraduationCap size={16} className={activeTab === "hostels" ? "text-amber-400" : "text-slate-400"} />
                      <span>{t("navHostels")}</span>
                    </div>
                    <span
                      className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                        activeTab === "hostels" ? "bg-amber-400 text-slate-950" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {profile.hostels.length}
                    </span>
                  </button>
                )}

                {apartments.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("apartments")}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all text-left cursor-pointer ${
                      activeTab === "apartments"
                        ? "bg-slate-900 text-white shadow-xs"
                        : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <IconBuilding size={16} className={activeTab === "apartments" ? "text-amber-400" : "text-slate-400"} />
                      <span>{t("navApartments")}</span>
                    </div>
                    <span
                      className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                        activeTab === "apartments" ? "bg-amber-400 text-slate-950" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {apartments.length}
                    </span>
                  </button>
                )}

                {profile.listings.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("all_listings")}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all text-left cursor-pointer ${
                      activeTab === "all_listings"
                        ? "bg-slate-900 text-white shadow-xs"
                        : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <IconHome size={16} className={activeTab === "all_listings" ? "text-amber-400" : "text-slate-400"} />
                      <span>{t("navListings")}</span>
                    </div>
                    <span
                      className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                        activeTab === "all_listings" ? "bg-amber-400 text-slate-950" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {profile.listings.length}
                    </span>
                  </button>
                )}

                {hasAnyGps && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("map")}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all text-left cursor-pointer ${
                      activeTab === "map"
                        ? "bg-amber-400 text-slate-950 shadow-xs"
                        : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <IconCompass size={16} className={activeTab === "map" ? "text-slate-950" : "text-amber-600"} />
                      <span>{t("navMap")}</span>
                    </div>
                    <span
                      className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                        activeTab === "map" ? "bg-slate-950 text-white" : "bg-amber-100 text-amber-900"
                      }`}
                    >
                      {geoProperties.length}
                    </span>
                  </button>
                )}

                {profile.technician && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("technician")}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all text-left cursor-pointer ${
                      activeTab === "technician"
                        ? "bg-slate-900 text-white shadow-xs"
                        : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <IconWrench size={16} className={activeTab === "technician" ? "text-amber-400" : "text-slate-400"} />
                      <span>{t("navServices")}</span>
                    </div>
                    <span
                      className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                        activeTab === "technician" ? "bg-amber-400 text-slate-950" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {profile.technician.completed_jobs} done
                    </span>
                  </button>
                )}

                {profile.driver && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("driver")}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all text-left cursor-pointer ${
                      activeTab === "driver"
                        ? "bg-slate-900 text-white shadow-xs"
                        : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <IconCar size={16} className={activeTab === "driver" ? "text-amber-400" : "text-slate-400"} />
                      <span>{t("navFleet")}</span>
                    </div>
                    <span
                      className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                        activeTab === "driver" ? "bg-amber-400 text-slate-950" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {profile.driver.vehicles.length}
                    </span>
                  </button>
                )}
              </nav>
            </div>

            {/* 3. Portfolio Summary Stats Card */}
            <div className="bg-white rounded-3xl p-5 border border-slate-200/90 shadow-xs">
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-3">
                {t("breakdown")}
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">{t("statHotels")}</span>
                  <span className="text-lg font-black text-slate-900">{profile.stats.hotels_count}</span>
                </div>
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">{t("statHostels")}</span>
                  <span className="text-lg font-black text-slate-900">{profile.stats.hostels_count}</span>
                </div>
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">{t("statFlats")}</span>
                  <span className="text-lg font-black text-slate-900">{profile.stats.apartments_count}</span>
                </div>
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">{t("statListings")}</span>
                  <span className="text-lg font-black text-slate-900">{profile.stats.listings_count}</span>
                </div>
              </div>
            </div>

            {/* 4. Trust & Escrow Guarantee Box */}
            <div className="bg-linear-to-br from-slate-900 to-indigo-950 rounded-3xl p-5 text-white shadow-md relative overflow-hidden">
              <div className="w-8 h-8 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-black mb-3 shadow-xs">
                <IconShieldCheck size={18} />
              </div>
              <h3 className="text-xs font-black uppercase tracking-wider text-amber-300 mb-1">
                {t("escrowTitle")}
              </h3>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                {t("escrowBody")}
              </p>
            </div>

            {/* 5. Direct Rating & Moderation */}
            <div className="bg-white rounded-3xl p-5 border border-slate-200/90 shadow-xs">
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-3">
                {t("rateMember")}
              </p>
              <RateAndReport subjectUserId={userId} />
            </div>
          </aside>

          {/* ======================================================= */}
          {/* MAIN CONTENT AREA (FLEX-1)                              */}
          {/* ======================================================= */}
          <div className="flex-1 min-w-0 space-y-6">
            {/* Desktop Active View Status Bar */}
            <div className="hidden md:flex items-center justify-between pb-3 border-b border-slate-200/80">
              <div>
                <h2 className="text-xl font-black text-slate-900">
                  {activeTab === "all"
                    ? t("titleAll")
                    : activeTab === "hotels"
                    ? t("titleHotels", { count: profile.hotels.length })
                    : activeTab === "hostels"
                    ? t("titleHostels", { count: profile.hostels.length })
                    : activeTab === "apartments"
                    ? t("titleApartments", { count: apartments.length })
                    : activeTab === "all_listings"
                    ? t("titleListings", { count: profile.listings.length })
                    : activeTab === "map"
                    ? t("titleMap", { count: geoProperties.length })
                    : activeTab === "technician"
                    ? t("titleServices")
                    : t("titleFleet")}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {t("subtitle", { name: profile.full_name })}
                </p>
              </div>

              {activeTab !== "all" && (
                <button
                  type="button"
                  onClick={() => setActiveTab("all")}
                  className="text-xs font-bold text-amber-600 hover:text-amber-700 underline cursor-pointer"
                >
                  {t("viewAll")}
                </button>
              )}
            </div>

        {/* Section 1: Hotels */}
        {(activeTab === "all" || activeTab === "hotels") && profile.hotels.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600">
                  <IconHotel size={18} />
                </div>
                <h2 className="text-lg font-bold text-slate-900">{t("navHotels")}</h2>
              </div>
              <span className="text-xs font-semibold text-slate-400">
                {t("hotelCount", { count: profile.hotels.length })}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {profile.hotels.map((h) => (
                <div
                  key={h.id}
                  className="bg-white rounded-3xl overflow-hidden border border-slate-200/80 shadow-xs hover:shadow-md transition-all group flex flex-col"
                >
                  <div className="relative aspect-16/10 bg-slate-100 overflow-hidden">
                    {h.photo_url ? (
                      <img
                        src={h.photo_url}
                        alt={h.quarter_name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-300">
                        <IconHotel size={40} />
                      </div>
                    )}
                    {h.star_rating && (
                      <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-950/80 text-amber-300 backdrop-blur-xs flex items-center gap-1">
                        {t("stars", { stars: h.star_rating })}
                      </span>
                    )}
                    {h.verified && (
                      <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500 text-white shadow-xs">
                        {t("verified")}
                      </span>
                    )}
                  </div>

                  <div className="p-5 flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="font-bold text-slate-900 group-hover:text-amber-600 transition-colors">
                        {h.name || t("hotelIn", { place: h.quarter_name || t("cameroon") })}
                      </h3>
                      <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                        <IconMapPin size={13} />
                        <span>{h.quarter_name}</span>
                        <span className="text-slate-300">•</span>
                        <span>{t("roomsCount", { count: h.total_rooms })}</span>
                      </p>

                      {h.room_categories.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {h.room_categories.slice(0, 3).map((cat) => (
                            <span
                              key={cat}
                              className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600"
                            >
                              {cat}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                      <div>
                        <span className="text-[11px] text-slate-400 block">{t("from")}</span>
                        <span className="text-sm font-extrabold text-slate-900">
                          {h.cheapest_rate_xaf ? Number(h.cheapest_rate_xaf).toLocaleString(locale) : t("contact")} XAF
                        </span>
                        <span className="text-[10px] text-slate-400"> {t("perNight")}</span>
                      </div>

                      <Link
                        href={`/hotels/${h.id}`}
                        className="px-3.5 py-1.5 rounded-xl font-bold text-xs bg-slate-900 text-white hover:bg-slate-800 transition-colors"
                      >
                        {t("seeRooms")}
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Section 2: Student Hostels */}
        {(activeTab === "all" || activeTab === "hostels") && profile.hostels.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600">
                  <IconGraduationCap size={18} />
                </div>
                <h2 className="text-lg font-bold text-slate-900">{t("navHostels")}</h2>
              </div>
              <span className="text-xs font-semibold text-slate-400">
                {t("hostelCount", { count: profile.hostels.length })}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {profile.hostels.map((sh) => (
                <div
                  key={sh.id}
                  className="bg-white rounded-3xl overflow-hidden border border-slate-200/80 shadow-xs hover:shadow-md transition-all group flex flex-col"
                >
                  <div className="relative aspect-16/10 bg-slate-100 overflow-hidden">
                    {sh.photo_url ? (
                      <img
                        src={sh.photo_url}
                        alt={sh.quarter_name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-300">
                        <IconGraduationCap size={40} />
                      </div>
                    )}
                    <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-950/80 text-indigo-300 backdrop-blur-xs">
                      {sh.property_type.replace(/_/g, " ")}
                    </span>
                  </div>

                  <div className="p-5 flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                        {sh.name || t("hostelIn", { place: sh.quarter_name || t("cameroon") })}
                      </h3>
                      <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                        <IconMapPin size={13} />
                        <span>{sh.quarter_name}</span>
                        <span className="text-slate-300">•</span>
                        <span>{t("unitsCount", { count: sh.total_units })}</span>
                      </p>

                      {sh.unit_types.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {sh.unit_types.map((ut) => (
                            <span
                              key={ut}
                              className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700"
                            >
                              {ut.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-500">{t("semester")}</span>
                      <Link
                        href={`/student-hostels/${sh.id}`}
                        className="px-3.5 py-1.5 rounded-xl font-bold text-xs bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
                      >
                        {t("seeRooms")}
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Section 3: Apartments & Residential Listings */}
        {(activeTab === "all" || activeTab === "apartments" || activeTab === "all_listings") && profile.listings.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600">
                  <IconBuilding size={18} />
                </div>
                <h2 className="text-lg font-bold text-slate-900">
                  {activeTab === "apartments" ? t("navApartments") : t("propertiesAndApartments")}
                </h2>
              </div>
              <span className="text-xs font-semibold text-slate-400">
                {t("listedCount", { count: activeTab === "apartments" ? apartments.length : profile.listings.length })}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {(activeTab === "apartments" ? apartments : profile.listings).map((item) => (
                <div
                  key={item.id}
                  className="bg-white rounded-3xl overflow-hidden border border-slate-200/80 shadow-xs hover:shadow-md transition-all group flex flex-col"
                >
                  <div className="relative aspect-16/10 bg-slate-100 overflow-hidden">
                    {item.photo_url ? (
                      <img
                        src={item.photo_url}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-300">
                        <IconHome size={40} />
                      </div>
                    )}
                    <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-950/80 text-amber-300 backdrop-blur-xs">
                      {item.listing_type}
                    </span>
                    {item.house_style && (
                      <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-800 shadow-xs">
                        {item.house_style.replace(/_/g, " ")}
                      </span>
                    )}
                  </div>

                  <div className="p-5 flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="font-bold text-slate-900 group-hover:text-amber-600 transition-colors line-clamp-1">
                        {item.title}
                      </h3>
                      <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                        <IconMapPin size={13} />
                        <span>{item.quarter_name || t("cameroon")}</span>
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                      <div>
                        <span className="text-sm font-extrabold text-slate-900">
                          {Number(item.price_xaf).toLocaleString(locale)} XAF
                        </span>
                        {item.listing_type === "RENT" && (
                          <span className="text-[10px] text-slate-400"> {t("perMonth")}</span>
                        )}
                      </div>

                      <Link
                        href={`/listing/${item.id}`}
                        className="px-3.5 py-1.5 rounded-xl font-bold text-xs bg-slate-900 text-white hover:bg-slate-800 transition-colors"
                      >
                        {t("details")}
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Section: Real Interactive Map for Property Location Tracking & Visiting */}
        {(activeTab === "all" || activeTab === "map") && hasAnyGps && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600">
                  <IconCompass size={18} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">{t("mapTitle")}</h2>
                  <p className="text-xs text-slate-500">
                    {t("mapIntro")}
                  </p>
                </div>
              </div>
              <span className="text-xs font-semibold text-slate-400">
                {t("geocoded", { count: geoProperties.length })}
              </span>
            </div>

            <div className="space-y-4">
              {geoProperties.map((prop) => (
                <div
                  key={prop.id}
                  className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xs space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-50 text-amber-900">
                          {prop.category}
                        </span>
                        <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                          {prop.title}
                        </h3>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                        <IconMapPin size={13} className="text-amber-500" />
                        <span>{prop.quarter_name}</span>
                        <span className="text-slate-300">•</span>
                        <span className="font-mono text-slate-600">
                          {prop.latitude.toFixed(5)}, {prop.longitude.toFixed(5)}
                        </span>
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${prop.latitude},${prop.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-400 text-slate-950 hover:bg-amber-300 transition-all shadow-xs active:scale-95"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="3 11 22 2 13 21 11 13 3 11" />
                        </svg>
                        <span>{t("openMaps")}</span>
                      </a>
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${prop.latitude},${prop.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                      >
                        <span>{t("viewPin")}</span>
                      </a>
                      <Link
                        href={prop.url}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors"
                      >
                        <span>{t("view")}</span>
                      </Link>
                    </div>
                  </div>

                  <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-inner">
                    <PropertyMap
                      latitude={prop.latitude}
                      longitude={prop.longitude}
                      label={`${prop.title} (${prop.category})`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Section 4: Technician Profile & Specialties */}
        {(activeTab === "all" || activeTab === "technician") && profile.technician && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600">
                  <IconWrench size={18} />
                </div>
                <h2 className="text-lg font-bold text-slate-900">{t("titleServices")}</h2>
              </div>
              <span className="text-xs font-semibold text-slate-400">
                {t("jobsCompleted", { count: profile.technician.completed_jobs })}
              </span>
            </div>

            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{t("vetting")}</span>
                    {profile.technician.is_verified ? (
                      <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <IconCheckCircle size={13} className="text-emerald-600" />
                        {t("techVerified")}
                      </span>
                    ) : (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        {t("regPending")}
                      </span>
                    )}
                  </div>
                  {profile.technician.coverage_quarter_name && (
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                      <IconMapPin size={13} />
                      <span>{t("coverage", { place: profile.technician.coverage_quarter_name })}</span>
                    </p>
                  )}
                </div>

                <Link
                  href={`/taskln-service?technician=${profile.user_id}`}
                  className="inline-flex items-center justify-center px-4 py-2 rounded-xl text-xs font-bold bg-amber-400 text-slate-950 hover:bg-amber-300 transition-colors shadow-2xs"
                >
                  {t("requestService")}
                </Link>
              </div>

              <div className="mt-4">
                <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">
                  {t("specialties")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {profile.technician.specialties.map((s) => (
                    <span
                      key={s}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-50 text-slate-700 border border-slate-200"
                    >
                      🛠️ {s.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Section 5: Driver Profile & Registered Vehicles */}
        {(activeTab === "all" || activeTab === "driver") && profile.driver && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600">
                  <IconCar size={18} />
                </div>
                <h2 className="text-lg font-bold text-slate-900">{t("titleFleet")}</h2>
              </div>
              <span className="text-xs font-semibold text-slate-400">
                {t("ridesDone", { count: profile.driver.completed_rides })}
              </span>
            </div>

            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{t("driverStatus")}</span>
                    {profile.driver.is_verified ? (
                      <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <IconCheckCircle size={13} className="text-emerald-600" />
                        {t("licensed")}
                      </span>
                    ) : (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        {t("pendingVerification")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {t("licenseNumber", { number: profile.driver.license_number })}
                  </p>
                </div>

                <Link
                  href="/oazigo"
                  className="inline-flex items-center justify-center px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors shadow-2xs"
                >
                  {t("bookRide")}
                </Link>
              </div>

              <div className="mt-4">
                <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">
                  {t("fleetVehicles")}
                </p>
                {profile.driver.vehicles.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {profile.driver.vehicles.map((v) => (
                      <div
                        key={v.id}
                        className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between"
                      >
                        <div>
                          <p className="text-sm font-bold text-slate-900">
                            {v.make} {v.model}
                          </p>
                          <p className="text-xs text-slate-400 font-mono mt-0.5">{v.plate_number}</p>
                        </div>
                        <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700">
                          {v.vehicle_category}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">{t("noVehicles")}</p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Empty portfolio fallback */}
        {profile.hotels.length === 0 && profile.hostels.length === 0 && profile.listings.length === 0 && !profile.technician && !profile.driver && (
          <div className="bg-white rounded-3xl p-12 text-center border border-slate-200/80 shadow-xs">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-4">
              <IconCompass size={32} />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">{t("emptyTitle")}</h3>
            <p className="text-sm text-slate-500 max-w-sm mx-auto mb-6">
              {t("emptyBody")}
            </p>
            <Link
              href="/search"
              className="inline-block px-5 py-2.5 rounded-xl font-bold text-xs bg-slate-900 text-white hover:bg-slate-800 transition-colors"
            >
              {t("browseMarket")}
            </Link>
          </div>
        )}

        {/* Credibility & Reporting Footer (Mobile Only, Desktop has it in sidebar) */}
        <div className="md:hidden bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs">
          <RateAndReport subjectUserId={userId} />
        </div>
      </div>
    </div>
  </div>

  {/* Share & QR Modal */}
  <ShareAndQrModal
    isOpen={showShareModal}
    onClose={() => setShowShareModal(false)}
    url={pageUrl}
    title={t("shareTitle", { name: profile.full_name })}
    subtitle={t("shareSubtitle")}
  />
</main>
  );
}
