import type { Metadata } from "next";
import "./globals.css";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

// WHY no next/font/google here: this sandbox has no network access to
// Google Fonts at build time. A system font stack is a legitimate,
// fast-loading choice for production too — many real sites use one
// deliberately to avoid a font-loading network request entirely.

export const metadata: Metadata = {
  title: "Oaziland — Real Estate in Cameroon",
  description: "Verified property listings, secure Mobile Money payments, and trusted local agents across Cameroon.",
  manifest: "/manifest.json",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
        {/* WHY Header/Footer live here, once, instead of being repeated
            on every page: it's the only way to GUARANTEE every page has
            consistent navigation — a page file simply can't forget to
            include it if it's not that page's responsibility at all. */}
        <Header />
        <div className="flex-1">{children}</div>
        <Footer />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
