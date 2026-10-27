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
  "/marketplace", "/marketplace/goods", "/marketplace/sell", "/marketplace/warehouses", "/marketplace/stores", "/marketplace/businesses", "/marketplace/cars",
  "/services", "/agents", "/agencies", "/testimonials", "/buy", "/sell",
  "/about", "/contact", "/trainings", "/how-it-works", "/careers",
];

interface PaginatedResponse<T> {
  next: string | null;
  results: T[];
}

async function fetchAllPages<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  let url: string | null = `${API_BASE_URL}${path}`;
  while (url) {
    const response = await fetch(url, { next: { revalidate: 3600 } });
    if (!response.ok) throw new Error(`Sitemap source failed: ${response.status}`);
    const page: PaginatedResponse<T> = await response.json();
    rows.push(...page.results);
    url = page.next;
  }
  return rows;
}

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
  let marketplaceEntries: MetadataRoute.Sitemap = [];
  try {
    const listings = await fetchAllPages<{ id: string; published_at: string | null }>("/api/listings/");
    listingEntries = LOCALES.flatMap((locale) =>
      listings.map((listing) => ({
          url: `${BASE_URL}/${locale}/listing/${listing.id}`,
          lastModified: listing.published_at || undefined,
          changeFrequency: "weekly" as const,
          priority: 0.9,
      }))
    );
  } catch {
    // Sitemap generation should never hard-fail the build over a
    // temporarily unreachable API — ship what we have.
  }

  const marketplaceCategories = ["warehouses", "stores", "businesses", "cars", "goods"] as const;
  const marketplaceResponses = await Promise.allSettled(
    marketplaceCategories.map(async (category) => ({
      category,
      listings: await fetchAllPages<{ id: string; created_at: string }>(`/api/${category}/`),
    })),
  );
  marketplaceEntries = marketplaceResponses.flatMap((response) => {
    if (response.status !== "fulfilled") return [];
    return LOCALES.flatMap((locale) =>
      response.value.listings.map((listing) => ({
        url: `${BASE_URL}/${locale}/marketplace/${response.value.category}/${listing.id}`,
        lastModified: listing.created_at,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      })),
    );
  });

  return [...staticEntries, ...listingEntries, ...marketplaceEntries];
}
