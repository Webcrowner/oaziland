import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Résidences Étudiantes au Cameroun | Oaziland" : "Student Hostels in Cameroon | Oaziland",
    description: locale === "fr"
      ? "Des hébergements étudiants vérifiés près des universités camerounaises."
      : "Verified student accommodation near Cameroonian universities.",
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
