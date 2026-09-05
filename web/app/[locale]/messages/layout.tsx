import type { Metadata } from "next";

// A private inbox has no unique content value for search, same
// reasoning as login/register/dashboard/referrals.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
