import type { Metadata } from "next";
import "./globals.css";

// WHY real system fonts here, not next/font/google: fetching fonts
// from Google's servers at BUILD time is a real, genuine point of
// failure — it can fail behind a restrictive network/proxy with a
// hard build error, not just a missing font. A carefully chosen
// system-font stack needs no network access at all, works reliably
// everywhere, and still reads as a deliberate typographic choice
// rather than a bare default: Charter/Georgia give the display
// headlines real serif warmth and character, while the body stack
// uses each platform's own clean, legible system UI font.

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
      <body className="min-h-full flex flex-col font-sans">
        {children}
      </body>
    </html>
  );
}
