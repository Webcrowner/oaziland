import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { IconShieldCheck, IconLock, IconPhoneCall } from "./Icons";

/**
 * Footer — high-end, comprehensive footer with dark theme,
 * trust badges, structured navigation, and mobile money security assurance.
 */
export default function Footer() {
  const t = useTranslations("Footer");

  return (
    <footer className="bg-[#0B132B] text-slate-300 border-t border-slate-800/80 mt-auto">
      {/* Trust & Guarantee bar */}
      <div className="border-b border-slate-800/80 bg-[#070D1E]/60 py-6 px-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs sm:text-sm">
          <div className="flex items-center gap-2.5 text-slate-200">
            <span className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
              <IconShieldCheck size={18} />
            </span>
            <div>
              <p className="font-semibold text-white">{t("trustBarTitle1")}</p>
              <p className="text-slate-400 text-xs">{t("trustBarDesc1")}</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 text-slate-200">
            <span className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
              <IconLock size={16} />
            </span>
            <div>
              <p className="font-semibold text-white">{t("trustBarTitle2")}</p>
              <p className="text-slate-400 text-xs">{t("trustBarDesc2")}</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 text-slate-200">
            <span className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold">
              <IconPhoneCall size={16} />
            </span>
            <div>
              <p className="font-semibold text-white">{t("trustBarTitle3")}</p>
              <p className="text-slate-400 text-xs">{t("trustBarCities")}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main footer directory */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 grid grid-cols-2 md:grid-cols-5 gap-8 lg:gap-12">
        <div className="col-span-2 md:col-span-1">
          <Link href="/" className="inline-block mb-4 transition-transform hover:scale-105">
            <Image
              src="/logo.png"
              alt="Oaziland"
              width={72}
              height={72}
              style={{ width: "auto", height: "64px" }}
              className="object-contain drop-shadow"
            />
          </Link>
          <p className="text-xs leading-relaxed text-slate-400 mb-4">{t("tagline")}</p>
          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400">
            <p className="font-medium text-slate-300 mb-1">{t("supportedPayments")}</p>
            <p className="text-amber-400 font-semibold">MTN MoMo • Orange Money • Visa</p>
          </div>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-4">{t("discover")}</h3>
          <ul className="text-xs space-y-2.5">
            <li><Link href="/search" className="hover:text-white transition-colors">{t("searchProperties")}</Link></li>
            <li><Link href="/buy" className="hover:text-white transition-colors">{t("buy")}</Link></li>
            <li><Link href="/sell" className="hover:text-white transition-colors">{t("sell")}</Link></li>
            <li><Link href="/hotels" className="hover:text-white transition-colors">{t("hotelsAndStays")}</Link></li>
            <li><Link href="/student-hostels" className="hover:text-white transition-colors">{t("studentHostels")}</Link></li>
            <li><Link href="/events" className="hover:text-white transition-colors">{t("eventVenues")}</Link></li>
            <li><Link href="/guest-houses" className="hover:text-white transition-colors">{t("guestHouses")}</Link></li>
            <li><Link href="/marketplace" className="hover:text-white transition-colors">{t("marketplace")}</Link></li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-4">{t("servicesAndTech")}</h3>
          <ul className="text-xs space-y-2.5">
            <li><Link href="/services" className="hover:text-white transition-colors">{t("services")}</Link></li>
            <li><Link href="/taskln-service" className="hover:text-white transition-colors">{t("tasklnService")}</Link></li>
            <li><Link href="/oazigo" className="hover:text-white transition-colors">{t("oazigoRides")}</Link></li>
            <li><Link href="/trainings" className="hover:text-white transition-colors">{t("trainings")}</Link></li>
            <li><Link href="/careers" className="hover:text-white transition-colors">{t("careers")}</Link></li>
            <li><Link href="/feed" className="hover:text-white transition-colors">{t("feed")}</Link></li>
            <li><Link href="/premium" className="hover:text-white transition-colors">{t("premium")}</Link></li>
            <li><Link href="/how-it-works" className="hover:text-white transition-colors">{t("howItWorks")}</Link></li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-4">{t("company")}</h3>
          <ul className="text-xs space-y-2.5">
            <li><Link href="/about" className="hover:text-white transition-colors">{t("about")}</Link></li>
            <li><Link href="/agents" className="hover:text-white transition-colors">{t("agents")}</Link></li>
            <li><Link href="/agencies" className="hover:text-white transition-colors">{t("agencies")}</Link></li>
            <li><Link href="/testimonials" className="hover:text-white transition-colors">{t("testimonials")}</Link></li>
            <li><Link href="/contact" className="hover:text-white transition-colors">{t("contact")}</Link></li>
            <li><Link href="/faq" className="hover:text-white transition-colors">{t("faq")}</Link></li>
            <li><Link href="/referrals" className="hover:text-white transition-colors">{t("referrals")}</Link></li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-4">{t("account")}</h3>
          <ul className="text-xs space-y-2.5">
            <li><Link href="/login" className="hover:text-white transition-colors">{t("signIn")}</Link></li>
            <li><Link href="/register" className="hover:text-white transition-colors">{t("register")}</Link></li>
            <li><Link href="/dashboard" className="hover:text-white transition-colors">{t("dashboard")}</Link></li>
            <li><Link href="/bookings" className="hover:text-white transition-colors">{t("myBookings")}</Link></li>
            <li><Link href="/finance" className="hover:text-white transition-colors">{t("financialTools")}</Link></li>
            <li><Link href="/property-management" className="hover:text-white transition-colors">{t("propertyManagement")}</Link></li>
            <li><Link href="/favorites" className="hover:text-white transition-colors">{t("favorites")}</Link></li>
            <li><Link href="/saved-searches" className="hover:text-white transition-colors">{t("savedSearches")}</Link></li>
          </ul>
        </div>
      </div>

      <div className="border-t border-slate-800/80 py-6 px-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <p>{t("copyright", { year: new Date().getFullYear() })}</p>
          <p className="text-slate-400">{t("brandName")} • {t("address")}</p>
        </div>
      </div>
    </footer>
  );
}
