import type { Metadata } from "next";

// Same reasoning as login/layout.tsx and register/layout.tsx — a
// listing-creation FORM has no unique content value for search
// (the resulting published listing does, and already has its own
// real metadata in listing/[id]/page.tsx).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ListPropertyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
