import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Maisons d'Hôtes au Cameroun | Oaziland" : "Guest Houses in Cameroon | Oaziland",
    description: locale === "fr"
      ? "Des logements de courte durée à travers le Cameroun, y compris des sites balnéaires à Kribi et Limbe."
      : "Short-stay lodges across Cameroon, including coastal leisure spots in Kribi and Limbe.",
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
