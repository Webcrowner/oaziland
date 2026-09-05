import type { Metadata } from "next";

// Same reasoning as login/register/list-property — a functional
// account-security flow has no unique content value for search.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function MfaSetupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
