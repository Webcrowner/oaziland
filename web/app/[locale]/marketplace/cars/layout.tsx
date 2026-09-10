import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Voitures à Vendre ou à Louer | Oaziland" : "Cars for Sale or Rent | Oaziland",
    description: locale === "fr"
      ? "Véhicules à vendre ou à louer à travers le Cameroun."
      : "Vehicles for sale or rent across Cameroon.",
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
