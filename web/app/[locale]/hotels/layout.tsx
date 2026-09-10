import type { Metadata } from "next";

/**
 * A real regression caught and fixed immediately: converting
 * hotels/page.tsx to a client component (needed for the real create
 * form) silently drops any generateMetadata export a page.tsx would
 * have had — Next.js's App Router only allows metadata exports from
 * Server Components. A layout.tsx one level up stays a real Server
 * Component regardless of what the page below it is, so real SEO
 * metadata lives here instead.
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Hôtels Vérifiés au Cameroun | Oaziland" : "Verified Hotels in Cameroon | Oaziland",
    description: locale === "fr"
      ? "Réservez des hôtels vérifiés à travers le Cameroun avec tarification en temps réel et paiement Mobile Money sécurisé."
      : "Book verified hotels across Cameroon with real-time pricing and secure Mobile Money payment.",
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
