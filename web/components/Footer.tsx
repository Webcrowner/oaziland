import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * Footer — a second, always-present navigation point. Easy-to-navigate
 * sites give people two ways to find their way around: the header at
 * the top, and a calm, complete list at the bottom once they've
 * scrolled past everything else. The newer pages (Services, Agents,
 * Agencies, About, Contact, Testimonials) live here rather than
 * crowding the already-full header nav.
 */
export default function Footer() {
  const t = useTranslations("Footer");

  return (
    <footer className="bg-gray-50 border-t mt-auto">
      <div className="max-w-6xl mx-auto px-4 py-10 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-8">
        <div className="col-span-1 sm:col-span-2 md:col-span-1">
          <Image src="/logo.svg" alt="Oaziland" width={130} height={28} />
          <p className="text-sm text-gray-500 mt-3">{t("tagline")}</p>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-[#1B2A4A] mb-3">{t("discover")}</h3>
          <ul className="text-sm text-gray-600 flex flex-col gap-2">
            <li><Link href="/search" className="hover:text-[#8A6D14] transition-colors">{t("searchProperties")}</Link></li>
            <li><Link href="/buy" className="hover:text-[#8A6D14] transition-colors">{t("buy")}</Link></li>
            <li><Link href="/sell" className="hover:text-[#8A6D14] transition-colors">{t("sell")}</Link></li>
            <li><Link href="/services" className="hover:text-[#8A6D14] transition-colors">{t("services")}</Link></li>
            <li><Link href="/trainings" className="hover:text-[#8A6D14] transition-colors">{t("trainings")}</Link></li>
            <li><Link href="/how-it-works" className="hover:text-[#8A6D14] transition-colors">{t("howItWorks")}</Link></li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-[#1B2A4A] mb-3">{t("company")}</h3>
          <ul className="text-sm text-gray-600 flex flex-col gap-2">
            <li><Link href="/about" className="hover:text-[#8A6D14] transition-colors">{t("about")}</Link></li>
            <li><Link href="/agents" className="hover:text-[#8A6D14] transition-colors">{t("agents")}</Link></li>
            <li><Link href="/agencies" className="hover:text-[#8A6D14] transition-colors">{t("agencies")}</Link></li>
            <li><Link href="/testimonials" className="hover:text-[#8A6D14] transition-colors">{t("testimonials")}</Link></li>
            <li><Link href="/contact" className="hover:text-[#8A6D14] transition-colors">{t("contact")}</Link></li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-[#1B2A4A] mb-3">{t("account")}</h3>
          <ul className="text-sm text-gray-600 flex flex-col gap-2">
            <li><Link href="/login" className="hover:text-[#8A6D14] transition-colors">{t("signIn")}</Link></li>
            <li><Link href="/register" className="hover:text-[#8A6D14] transition-colors">{t("register")}</Link></li>
            <li><Link href="/messages" className="hover:text-[#8A6D14] transition-colors">{t("messages")}</Link></li>
            <li><Link href="/dashboard" className="hover:text-[#8A6D14] transition-colors">{t("dashboard")}</Link></li>
            <li><Link href="/referrals" className="hover:text-[#8A6D14] transition-colors">{t("referrals")}</Link></li>
          </ul>
          <h3 className="text-sm font-semibold text-[#1B2A4A] mb-3 mt-6">{t("brandName")}</h3>
          <p className="text-sm text-gray-500">{t("address")}</p>
        </div>
      </div>
      <div className="border-t text-center text-xs text-gray-500 py-4">
        {t("copyright", { year: new Date().getFullYear() })}
      </div>
    </footer>
  );
}
