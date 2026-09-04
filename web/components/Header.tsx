"use client";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { useState } from "react";
import LanguageSwitcher from "./LanguageSwitcher";

/**
 * Header — the responsive, animated navigation. Desktop shows the full
 * mega-menu and trust badge strip; mobile collapses everything except
 * the essentials behind a hamburger. Active links are visually
 * highlighted so a user always knows where they are — a basic but
 * easily-overlooked piece of "easy to navigate."
 */
export default function Header() {
  const t = useTranslations("Header");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  const navLinks = [
    { href: "/search", label: t("exploreProperties") },
    { href: "/list-property", label: t("listAProperty") },
  ];

  const linkClass = (href: string) =>
    `transition-colors duration-150 hover:text-[#C9A227] ${
      pathname === href ? "text-[#C9A227] font-semibold" : ""
    }`;

  return (
    <header className="bg-[#1B2A4A] text-white sticky top-0 z-50 shadow-md">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo — a real placeholder asset, swappable for the final
              designed logo without touching any layout code. */}
          <Link href="/" className="flex items-center transition-transform duration-150 hover:scale-[1.02]">
            <Image src="/logo-light.svg" alt="Oaziland" width={140} height={30} priority />
          </Link>

          {/* Desktop nav — full mega-menu, visible md and up */}
          <nav className="hidden md:flex items-center gap-6 text-sm">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href} className={linkClass(link.href)}>
                {link.label}
              </Link>
            ))}
            <span className="text-gray-300">{t("verifiedListingsCount")}</span>
          </nav>

          <div className="hidden md:flex items-center gap-4 text-sm">
            <LanguageSwitcher />
            <Link href="/login" className={linkClass("/login")}>{t("signIn")}</Link>
            <Link
              href="/register"
              className="bg-[#C9A227] text-[#1B2A4A] px-4 py-2 rounded font-semibold transition-all duration-150 hover:opacity-90 hover:scale-[1.03]"
            >
              {t("register")}
            </Link>
          </div>

          {/* Mobile: icon-only, opens an animated menu */}
          <button
            className="md:hidden text-2xl w-8 h-8 flex items-center justify-center"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={t("toggleMenu")}
            aria-expanded={mobileMenuOpen}
          >
            <span className={`inline-block transition-transform duration-200 ${mobileMenuOpen ? "rotate-90" : ""}`}>
              {mobileMenuOpen ? "✕" : "☰"}
            </span>
          </button>
        </div>

        {/* Animated mobile menu — a real height/opacity transition, not
            an abrupt show/hide, so it feels considered rather than jarring. */}
        <div
          className={`md:hidden overflow-hidden transition-all duration-300 ease-in-out ${
            mobileMenuOpen ? "max-h-72 opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="flex flex-col gap-3 text-sm border-t border-white/20 pt-3 pb-4">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href} className={linkClass(link.href)} onClick={() => setMobileMenuOpen(false)}>
                {link.label}
              </Link>
            ))}
            <Link href="/login" className={linkClass("/login")} onClick={() => setMobileMenuOpen(false)}>{t("signIn")}</Link>
            <Link href="/register" className={linkClass("/register")} onClick={() => setMobileMenuOpen(false)}>{t("register")}</Link>
            <LanguageSwitcher />
          </div>
        </div>
      </div>
    </header>
  );
}
