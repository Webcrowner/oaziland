"use client";
import Link from "next/link";
import { useState } from "react";

/**
 * Header — the responsive navigation. Desktop shows the full mega-menu
 * and trust badge strip (per the UML spec's Section 13 responsive
 * design table); mobile collapses everything except the essentials
 * behind a hamburger, since a phone screen should prioritize the
 * search bar above all else.
 */
export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="bg-[#1B2A4A] text-white">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="text-xl font-bold text-[#C9A227]">
            OAZILAND
          </Link>

          {/* Desktop nav — full mega-menu, visible md and up */}
          <nav className="hidden md:flex items-center gap-6 text-sm">
            <Link href="/search" className="hover:text-[#C9A227]">Explore Properties</Link>
            <Link href="/list-property" className="hover:text-[#C9A227]">List a Property</Link>
            <span className="text-gray-300">10,000+ Verified Listings</span>
          </nav>

          <div className="hidden md:flex items-center gap-4 text-sm">
            <Link href="/login" className="hover:text-[#C9A227]">Sign In</Link>
            <Link href="/register" className="bg-[#C9A227] text-[#1B2A4A] px-4 py-2 rounded font-semibold hover:opacity-90">
              Register
            </Link>
          </div>

          {/* Mobile: icon-only, opens a simple menu — no mega-menu, no
              trust-badge strip, per the responsive design table. */}
          <button
            className="md:hidden text-2xl"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            ☰
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden pb-4 flex flex-col gap-3 text-sm border-t border-white/20 pt-3">
            <Link href="/search">Explore Properties</Link>
            <Link href="/list-property">List a Property</Link>
            <Link href="/login">Sign In</Link>
            <Link href="/register">Register</Link>
          </div>
        )}
      </div>
    </header>
  );
}
