import type { Metadata } from "next";
import "./globals.css";

// WHY this root layout is deliberately minimal: with next-intl,
// [locale]/layout.tsx is where the real page shell (Header, Footer,
// translation provider) lives — this root layout only needs to exist
// so <html>/<body> are defined once, above the locale split.

export const metadata: Metadata = {
  title: "Oaziland — Real Estate in Cameroon",
  description: "Verified property listings, secure Mobile Money payments, and trusted local agents across Cameroon.",
  manifest: "/manifest.json",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
