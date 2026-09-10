import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    robots: { index: false, follow: false },
    title: locale === "fr" ? "Mes Réservations | Oaziland" : "My Bookings | Oaziland",
    description: locale === "fr" ? "Vos réservations et paiements réels." : "Your real bookings and payments.",
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
