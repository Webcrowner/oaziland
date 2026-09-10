import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Boutiques à Louer ou à Vendre | Oaziland" : "Stores for Rent or Sale | Oaziland",
    description: locale === "fr"
      ? "Devantures commerciales à travers le Cameroun."
      : "Retail shopfronts across Cameroon.",
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
