import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import SiteChrome from "@/components/SiteChrome";
import SupportChatWidget from "@/components/SupportChatWidget";
import PresenceHeartbeat from "@/components/PresenceHeartbeat";
import GlobalMobileNav from "@/components/GlobalMobileNav";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // Enables static rendering for this locale — required by next-intl
  // when reading the locale from route params rather than a cookie.
  setRequestLocale(locale);

  return (
    <NextIntlClientProvider>
      {/* WHY Header/Footer live here, once, instead of being repeated
          on every page: it's the only way to GUARANTEE every page has
          consistent navigation — a page file simply can't forget to
          include it if it's not that page's responsibility at all. */}
      <SiteChrome>
        <Navbar />
      </SiteChrome>
      <div className="flex-1">{children}</div>
      <SiteChrome>
        <Footer />
      </SiteChrome>
      <ServiceWorkerRegister />
      <SupportChatWidget />
      <GlobalMobileNav />
      <PresenceHeartbeat />
    </NextIntlClientProvider>
  );
}
