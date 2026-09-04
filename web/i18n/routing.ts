import { defineRouting } from "next-intl/routing";

/**
 * Two locales: English (default) and French — Cameroon's other
 * official language and the primary language for a large share of
 * the platform's real audience, per the founder's explicit request
 * for bilingual support.
 */
export const routing = defineRouting({
  locales: ["en", "fr"],
  defaultLocale: "en",
});
