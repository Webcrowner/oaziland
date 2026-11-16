import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import LegalDocument from "@/components/LegalDocument";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("LegalPage");
  return { title: t("terms_title") };
}

export default function TermsPage() {
  return <LegalDocument type="TERMS_OF_SERVICE" />;
}
