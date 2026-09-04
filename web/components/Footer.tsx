import Link from "next/link";
import Image from "next/image";

/**
 * Footer — a second, always-present navigation point. Easy-to-navigate
 * sites give people two ways to find their way around: the header at
 * the top, and a calm, complete list at the bottom once they've
 * scrolled past everything else.
 */
export default function Footer() {
  return (
    <footer className="bg-gray-50 border-t mt-auto">
      <div className="max-w-6xl mx-auto px-4 py-10 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8">
        <div className="col-span-1 sm:col-span-2 md:col-span-1">
          <Image src="/logo.svg" alt="Oaziland" width={130} height={28} />
          <p className="text-sm text-gray-500 mt-3">
            Verified real estate listings across Cameroon.
          </p>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-[#1B2A4A] mb-3">Discover</h3>
          <ul className="text-sm text-gray-600 flex flex-col gap-2">
            <li><Link href="/search" className="hover:text-[#8A6D14] transition-colors">Search Properties</Link></li>
            <li><Link href="/list-property" className="hover:text-[#8A6D14] transition-colors">List a Property</Link></li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-[#1B2A4A] mb-3">Account</h3>
          <ul className="text-sm text-gray-600 flex flex-col gap-2">
            <li><Link href="/login" className="hover:text-[#8A6D14] transition-colors">Sign In</Link></li>
            <li><Link href="/register" className="hover:text-[#8A6D14] transition-colors">Register</Link></li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-[#1B2A4A] mb-3">Oaziland</h3>
          <p className="text-sm text-gray-500">Messassi, Yaoundé, Cameroon</p>
        </div>
      </div>
      <div className="border-t text-center text-xs text-gray-500 py-4">
        © {new Date().getFullYear()} Oaziland. All rights reserved.
      </div>
    </footer>
  );
}
