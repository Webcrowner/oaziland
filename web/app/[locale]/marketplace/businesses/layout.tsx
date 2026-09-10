import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Entreprises à Vendre au Cameroun | Oaziland" : "Businesses for Sale in Cameroon | Oaziland",
    description: locale === "fr"
      ? "Entreprises en activité à vendre — avec ou sans stock et clientèle."
      : "Going concerns for sale — with or without inventory and goodwill.",
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
