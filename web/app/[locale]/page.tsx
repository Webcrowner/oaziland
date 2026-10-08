import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Image from "next/image";
import { listQuarters, searchListings, listTestimonials, getHomeStats, listPublicFaqs } from "@/lib/api";
import type { Metadata } from "next";
import {
  IconMapPin,
  IconBuilding,
  IconShieldCheck,
  IconLock,
  IconSparkles,
  IconGraduationCap,
  IconHotel,
  IconParty,
  IconShoppingBag,
  IconWrench,
  IconCar,
  IconBriefcase,
  IconArrowUpRight,
  IconStar,
  IconHome,
  IconClock,
  IconCheckCircle,
} from "@/components/Icons";

// Dynamic interactive client components
import HeroSearchConsole from "@/components/home/HeroSearchConsole";
import LiveMarketTicker from "@/components/home/LiveMarketTicker";
import FeaturedListings from "@/components/home/FeaturedListings";
import PopularNeighborhoods from "@/components/home/PopularNeighborhoods";
import InteractiveAffordabilityCalculator from "@/components/home/InteractiveAffordabilityCalculator";
import InteractiveFaqAccordion from "@/components/home/InteractiveFaqAccordion";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr"
      ? "Oaziland — Immobilier, Hôtels et Super-App au Cameroun"
      : "Oaziland — Real Estate, Hotels & Super-App in Cameroon",
    description: locale === "fr"
      ? "Trouvez des propriétés vérifiées à louer ou à vendre, hôtels, résidences étudiantes, et services sécurisés au Cameroun avec séquestre Mobile Money."
      : "Find verified properties to rent or buy, hotels, student hostels, and trusted local services across Cameroon with Mobile Money escrow.",
  };
}

export default async function HomePage() {
  const t = await getTranslations("HomePage");
  const quarters = await listQuarters().catch(() => []);
  const featuredListings = await searchListings({}).then((data) => data.results.slice(0, 6)).catch(() => []);
  const testimonials = await listTestimonials().then((data) => data.results.slice(0, 3)).catch(() => []);
  const stats = await getHomeStats().catch(() => null);
  const faqs = await listPublicFaqs(await getLocale(), true).catch(() => []);

  const tickerItems = stats
    ? [
        { count: stats.new_listings_24h, key: "tickerNewListings", link: "/search" },
        { count: stats.rent_listings, key: "tickerRentals", link: "/search?listing_type=RENT" },
        { count: stats.sale_listings, key: "tickerSales", link: "/buy" },
        { count: stats.student_hostels, key: "tickerHostels", link: "/student-hostels" },
        { count: stats.hotels, key: "tickerHotels", link: "/hotels" },
        { count: stats.guest_houses, key: "tickerGuestHouses", link: "/guest-houses" },
        { count: stats.venues, key: "tickerVenues", link: "/events" },
        { count: stats.drivers, key: "tickerDrivers", link: "/oazigo" },
      ]
        .filter((item) => item.count > 0)
        .map((item) => ({ text: t(item.key, { count: item.count }), link: item.link }))
    : [];

  return (
    <main className="bg-slate-50 min-h-screen">
      {/* ================= HERO WITH DYNAMIC SEARCH CONSOLE ================= */}
      <section className="relative overflow-hidden hero-gradient text-white pt-10 pb-28 md:pt-16 md:pb-36 border-b border-slate-800">
        {/* Real photo background — a trusted Cameroon home/stay behind the
            headline, shown at full brightness with no dark/blur overlay. */}
        <div className="absolute inset-0">
          <Image
            src="/images/hero-trust-cameroon.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-center"
          />
        </div>

        {/* Ambient background glow & geometric grid */}
        <div className="absolute inset-0 bg-[radial-gradient(#ffffff0a_1px,transparent_1px)] [background-size:24px_24px] pointer-events-none opacity-40" />
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-amber-500/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute top-1/2 right-10 w-[400px] h-[300px] bg-blue-600/10 blur-[100px] rounded-full pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 text-center">
          {/* Trust Pill */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/15 text-xs font-medium text-amber-300 mb-6 backdrop-blur-md animate-rise-in">
            <IconSparkles size={14} className="text-amber-400" />
            <span>{t("trustPill")}</span>
          </div>

          <h1
            className="font-[family-name:var(--font-display)] text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.15] mb-5 max-w-4xl mx-auto animate-rise-in [text-shadow:0_2px_20px_rgba(0,0,0,0.8)]"
            style={{ animationDelay: "100ms" }}
          >
            {t("heroTitleV2")}
          </h1>

          <p
            className="text-slate-200 text-sm sm:text-base md:text-lg mb-8 max-w-2xl mx-auto leading-relaxed animate-rise-in font-normal [text-shadow:0_1px_12px_rgba(0,0,0,0.9)]"
            style={{ animationDelay: "200ms" }}
          >
            {t("heroSubtitleV2")}
          </p>

          {/* Interactive Dynamic Search Console (Client Component) */}
          <HeroSearchConsole quarters={quarters} popularQuarters={stats?.popular_quarters ?? []} />
        </div>
      </section>

      {/* ================= DYNAMIC LIVE MARKET PULSE TICKER ================= */}
      <LiveMarketTicker items={tickerItems} label={t("tickerLabel")} />

      {/* ================= TRUST BADGES STRIP ================= */}
      <section className="relative -mt-10 sm:-mt-12 z-20 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 p-5 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
            <div className="flex items-start gap-3.5 pt-3 sm:pt-0 sm:px-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <IconShieldCheck size={22} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">{t("trustStripVerifiedTitle")}</h4>
                <p className="text-xs text-slate-500 leading-relaxed mt-0.5">
                  {t("trustStripVerifiedDesc")}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3.5 pt-4 sm:pt-0 sm:px-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                <IconClock size={20} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">{t("trustStripHoldTitle")}</h4>
                <p className="text-xs text-slate-500 leading-relaxed mt-0.5">
                  {t("trustStripHoldDesc")}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3.5 pt-4 sm:pt-0 sm:px-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <IconLock size={20} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">{t("trustStripEscrowTitle")}</h4>
                <p className="text-xs text-slate-500 leading-relaxed mt-0.5">
                  {t("trustStripEscrowDesc")}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3.5 pt-4 sm:pt-0 sm:px-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                <IconCheckCircle size={20} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">{t("trustStripAgenciesTitle")}</h4>
                <p className="text-xs text-slate-500 leading-relaxed mt-0.5">
                  {t("trustStripAgenciesDesc")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= EXPLORE CATEGORIES (SUPER-APP) ================= */}
      <section className="py-16 sm:py-20 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 sm:mb-10">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-amber-600 mb-1.5">{t("ecosystemEyebrow")}</p>
              <h2 className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-bold text-slate-900">
                {t("ecosystemTitle")}
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 mt-2 sm:mt-0 max-w-md">
              {t("ecosystemSubtitle")}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 sm:gap-4">
            {[
              {
                title: t("catRentalsTitle"),
                desc: t("catRentalsDesc"),
                href: "/search?listing_type=RENT",
                icon: <IconHome size={22} className="text-blue-600" />,
                bg: "bg-blue-50/80",
                badge: null,
              },
              {
                title: t("catBuyTitle"),
                desc: t("catBuyDesc"),
                href: "/buy",
                icon: <IconBuilding size={22} className="text-emerald-600" />,
                bg: "bg-emerald-50/80",
                badge: null,
              },
              {
                title: t("catStudentTitle"),
                desc: t("catStudentDesc"),
                href: "/student-hostels",
                icon: <IconGraduationCap size={22} className="text-indigo-600" />,
                bg: "bg-indigo-50/80",
                badge: null,
              },
              {
                title: t("catHotelsTitle"),
                desc: t("catHotelsDesc"),
                href: "/hotels",
                icon: <IconHotel size={22} className="text-amber-600" />,
                bg: "bg-amber-50/80",
                badge: null,
              },
              {
                title: t("catGuestTitle"),
                desc: t("catGuestDesc"),
                href: "/guest-houses",
                icon: <IconHome size={22} className="text-teal-600" />,
                bg: "bg-teal-50/80",
                badge: null,
              },
              {
                title: t("catEventsTitle"),
                desc: t("catEventsDesc"),
                href: "/events",
                icon: <IconParty size={22} className="text-pink-600" />,
                bg: "bg-pink-50/80",
                badge: null,
              },
              {
                title: t("catRidesTitle"),
                desc: t("catRidesDesc"),
                href: "/oazigo",
                icon: <IconCar size={22} className="text-orange-600" />,
                bg: "bg-orange-50/80",
                badge: null,
              },
              {
                title: t("catMarketplaceTitle"),
                desc: t("catMarketplaceDesc"),
                href: "/marketplace",
                icon: <IconShoppingBag size={22} className="text-violet-600" />,
                bg: "bg-violet-50/80",
                badge: null,
              },
              {
                title: t("catTasklnTitle"),
                desc: t("catTasklnDesc"),
                href: "/taskln-service",
                icon: <IconWrench size={22} className="text-cyan-600" />,
                bg: "bg-cyan-50/80",
                badge: null,
              },
              {
                title: t("catCareersTitle"),
                desc: t("catCareersDesc"),
                href: "/careers",
                icon: <IconBriefcase size={22} className="text-slate-600" />,
                bg: "bg-slate-100",
                badge: null,
              },
            ].map((cat) => (
              <Link
                key={cat.title}
                href={cat.href}
                className="group relative bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 flex flex-col justify-between transition-all duration-200 hover:border-amber-400 hover:shadow-lg hover:-translate-y-1"
              >
                {cat.badge && (
                  <span className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                    {cat.badge}
                  </span>
                )}
                <div>
                  <div className={`w-11 h-11 rounded-xl ${cat.bg} flex items-center justify-center mb-3.5 transition-transform duration-200 group-hover:scale-110`}>
                    {cat.icon}
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 group-hover:text-amber-600 transition-colors">
                    {cat.title}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-1">{cat.desc}</p>
                </div>
                <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] font-semibold text-slate-400 group-hover:text-amber-600 transition-colors">
                  <span>{t("exploreLabel")}</span>
                  <IconArrowUpRight size={13} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ================= DYNAMIC PROPERTY EXPLORER (CLIENT COMPONENT WITH TABS & CURRENCY CONVERTER) ================= */}
      <FeaturedListings liveListings={featuredListings} />

      {/* ================= INTERACTIVE NEIGHBORHOOD EXPLORER (CITY TABS & STATS) ================= */}
      <PopularNeighborhoods quarters={stats?.popular_quarters ?? []} />

      {/* ================= THE CAMEROON TRUST ADVANTAGE ================= */}
      <section className="py-20 px-4 sm:px-6 bg-[var(--navy)] text-white relative overflow-hidden">
        <div className="absolute -bottom-20 right-0 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-6xl mx-auto relative z-10">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-2 block">
              {t("trustAdvEyebrow")}
            </span>
            <h2 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl font-bold mb-4">
              {t("trustAdvTitle")}
            </h2>
            <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
              {t("trustAdvSubtitle")}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-7 backdrop-blur-sm transition-all duration-300 hover:bg-white/10 hover:border-amber-400/40">
              <div className="w-12 h-12 rounded-xl bg-amber-400/20 text-amber-400 flex items-center justify-center mb-5">
                <IconShieldCheck size={26} />
              </div>
              <h3 className="text-lg font-bold text-white mb-2.5">{t("trustAdvCard1Title")}</h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                {t("trustAdvCard1Desc")}
              </p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-7 backdrop-blur-sm transition-all duration-300 hover:bg-white/10 hover:border-amber-400/40">
              <div className="w-12 h-12 rounded-xl bg-blue-400/20 text-blue-400 flex items-center justify-center mb-5">
                <IconClock size={26} />
              </div>
              <h3 className="text-lg font-bold text-white mb-2.5">{t("trustAdvCard2Title")}</h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                {t("trustAdvCard2Desc")}
              </p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-7 backdrop-blur-sm transition-all duration-300 hover:bg-white/10 hover:border-amber-400/40">
              <div className="w-12 h-12 rounded-xl bg-emerald-400/20 text-emerald-400 flex items-center justify-center mb-5">
                <IconLock size={26} />
              </div>
              <h3 className="text-lg font-bold text-white mb-2.5">{t("trustAdvCard3Title")}</h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                {t("trustAdvCard3Desc")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ================= DYNAMIC INTERACTIVE AFFORDABILITY CALCULATOR ================= */}
      <InteractiveAffordabilityCalculator />

      {/* ================= TESTIMONIALS / PROOF ================= */}
      {testimonials.length > 0 && (
      <section className="py-16 sm:py-20 px-4 sm:px-6 bg-slate-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-600 mb-1">{t("testimonialsEyebrow")}</p>
            <h2 className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-bold text-slate-900">
              {t("testimonialsTitleV2")}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((testi, i) => (
              <div key={i} className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-1 text-amber-400 mb-3">
                    {Array.from({ length: Math.max(1, Math.min(5, Math.round(testi.score))) }).map((_, r) => (
                      <IconStar key={r} size={16} />
                    ))}
                  </div>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed italic mb-6">
                    &quot;{testi.text}&quot;
                  </p>
                </div>
                <div className="pt-3 border-t border-slate-100">
                  <p className="text-sm font-bold text-slate-900">{testi.author_name}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      )}

      {/* ================= DYNAMIC INTERACTIVE FAQS ================= */}
      <InteractiveFaqAccordion faqs={faqs} showViewAll />

      {/* ================= MOBILE APP & SUPER-APP BANNER ================= */}
      <section className="py-14 px-4 sm:px-6 bg-gradient-to-br from-slate-900 via-slate-800 to-amber-950 text-white border-t border-slate-800">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="max-w-xl text-center md:text-left">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-2 block">
              {t("mobileEyebrow")}
            </span>
            <h2 className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-bold mb-3">
              {t("mobileTitle")}
            </h2>
            <p className="text-slate-300 text-xs sm:text-sm leading-relaxed mb-6">
              {t("mobileDesc")}
            </p>
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
              <Link
                href="/list-property"
                className="gold-gradient text-[var(--navy)] text-xs sm:text-sm font-bold px-5 py-2.5 rounded-xl hover:shadow-lg transition-transform active:scale-95"
              >
                {t("ctaListProperty")}
              </Link>
              <Link
                href="/how-it-works"
                className="bg-white/10 hover:bg-white/15 border border-white/20 text-white text-xs sm:text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
              >
                {t("ctaHowItWorks")}
              </Link>
            </div>
          </div>

          <div className="p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md max-w-sm w-full text-center">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-1">{t("assistanceEyebrow")}</p>
            <h3 className="text-base font-bold text-white mb-2">{t("assistanceTitle")}</h3>
            <p className="text-xs text-slate-300 mb-4">
              {t("assistanceDesc")}
            </p>
            <Link
              href="/contact"
              className="block w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors"
            >
              {t("contactSupportBtn")}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
