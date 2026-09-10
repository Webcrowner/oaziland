import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "OaziGo — Transport et Livraison | Oaziland" : "OaziGo — Rides and Transport | Oaziland",
    description: locale === "fr"
      ? "Réservez un trajet ou transportez des matériaux de construction entre propriétés — moto, voiture, van ou camion."
      : "Book a ride or move building materials between properties — moto, car, van, or truck.",
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
