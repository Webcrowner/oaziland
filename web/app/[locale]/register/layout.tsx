import type { Metadata } from "next";

// Same reasoning as login/layout.tsx — a registration form has no
// unique content value for search results.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
