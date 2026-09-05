import type { Metadata } from "next";

// WHY a separate layout.tsx just for this: login/page.tsx is a Client
// Component ("use client"), and Next.js only reads metadata exports
// from Server Components — this thin Server Component wrapper is
// what actually lets noindex apply. A login form has zero unique
// content value for search results; indexing it just dilutes the
// site's real content pages' relevance.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
