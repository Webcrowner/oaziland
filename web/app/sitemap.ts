import type { MetadataRoute } from "next";
import { API_BASE_URL } from "@/lib/api";

const BASE_URL = "https://oaziland.com";
const LOCALES = ["en", "fr"];

// Every stable, indexable route — deliberately excludes /search (set
// noindex on its own page, since filter permutations create
// duplicate-content risk) and login/register/list-property (pure
// functional forms, also noindex on their own layouts).
// WHY this list needed updating: several real, public pages (Services,
// Agents, Agencies, Testimonials, Buy, Sell, About, Contact, Trainings,
// How It Works) were built after this sitemap was first written, and
// never got added — a real oversight, not a deliberate exclusion.
// Every one of these is genuinely public and worth indexing.
const STATIC_ROUTES = [
  "", "/hotels", "/events", "/guest-houses", "/student-hostels", "/wanted",
  "/services", "/agents", "/agencies", "/testimonials", "/buy", "/sell",
  "/about", "/contact", "/trainings", "/how-it-works",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = LOCALES.flatMap((locale) =>
    STATIC_ROUTES.map((route) => ({
      url: `${BASE_URL}/${locale}${route}`,
      changeFrequency: route === "" ? "daily" : "hourly",
      priority: route === "" ? 1.0 : 0.8,
    })) as MetadataRoute.Sitemap
  );

  // WHY real listings are fetched here, not just the static shell of
  // pages: the actual money pages for a real estate marketplace are
  // the individual property listings — a sitemap that only lists the
  // homepage and category pages misses the content that's actually
  // worth ranking. Fails gracefully (returns just the static routes)
  // if the API is unreachable at build/request time, rather than
  // breaking the whole sitemap.
  let listingEntries: MetadataRoute.Sitemap = [];
  try {
    const res = await fetch(`${API_BASE_URL}/api/listings/`, { next: { revalidate: 3600 } });
    if (res.ok) {
      const data = await res.json();
      listingEntries = LOCALES.flatMap((locale) =>
        (data.results || []).map((listing: { id: string; published_at: string | null }) => ({
          url: `${BASE_URL}/${locale}/listing/${listing.id}`,
          lastModified: listing.published_at || undefined,
          changeFrequency: "weekly" as const,
          priority: 0.9,
        }))
      );
    }
  } catch {
    // Sitemap generation should never hard-fail the build over a
    // temporarily unreachable API — ship what we have.
  }

  return [...staticEntries, ...listingEntries];
}
