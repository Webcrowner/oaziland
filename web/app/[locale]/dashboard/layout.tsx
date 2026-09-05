import type { Metadata } from "next";

// A private dashboard has no unique content value for search, same
// reasoning as login/register/mfa-setup/referrals.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
