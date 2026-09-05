import type { MetadataRoute } from "next";

/**
 * WHY /search is NOT disallowed here even though it's set noindex via
 * its own page metadata: Google's own guidance is to let crawlers
 * actually CRAWL a noindex page so they can see the noindex directive
 * itself — blocking it in robots.txt instead can sometimes leave a
 * bare URL (with no snippet) showing up in results anyway, since the
 * crawler never got far enough to see the noindex tag. The meta tag
 * on the page itself is the correct, complete mechanism; robots.txt
 * only needs to keep out login/register/list-property.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = "https://oaziland.com";
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/*/login", "/*/register", "/*/list-property"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
