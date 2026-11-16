import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import LegalDocument from "@/components/LegalDocument";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("LegalPage");
  return { title: t("privacy_title") };
}

export default function PrivacyPage() {
  return <LegalDocument type="PRIVACY_POLICY" />;
}
