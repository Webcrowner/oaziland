import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Outils Financiers | Oaziland" : "Financial Tools | Oaziland",
    description: locale === "fr"
      ? "Estimez la valeur d'une propriété ou le loyer que vous pouvez vous permettre — des formules simples et transparentes."
      : "Estimate a property's value or the rent you can afford — simple, transparent formulas.",
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
