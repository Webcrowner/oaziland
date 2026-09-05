import type { Metadata } from "next";

// Same reasoning as login/register/mfa-setup — a personal referral
// code page has no unique content value for search.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ReferralsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
