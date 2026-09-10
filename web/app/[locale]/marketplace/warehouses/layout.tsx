import type { Metadata } from "next";

/**
 * A real, retroactive fix: this category page (a client component,
 * needed for its interactive create form) has had no real SEO
 * metadata since it was first built — Next.js's App Router only
 * allows generateMetadata from Server Components, and nothing ever
 * added the layout.tsx a client page.tsx needs for this. Found while
 * fixing the identical gap on Hotels/Events.
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Entrepôts à Louer ou à Vendre | Oaziland" : "Warehouses for Rent or Sale | Oaziland",
    description: locale === "fr"
      ? "Espace de stockage et industriel à travers le Cameroun."
      : "Storage and industrial space across Cameroon.",
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
