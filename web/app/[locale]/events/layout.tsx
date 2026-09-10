import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Salles d'Événements au Cameroun | Oaziland" : "Event Venues in Cameroon | Oaziland",
    description: locale === "fr"
      ? "Des espaces événementiels vérifiés pour conférences, mariages et célébrations à travers le Cameroun."
      : "Verified event spaces for conferences, weddings, and celebrations across Cameroon.",
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
