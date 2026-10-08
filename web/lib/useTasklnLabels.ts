import { useTranslations } from "next-intl";

export const TASKLN_CATEGORY_CODES = [
  "PLUMBING", "ELECTRICAL", "PAINTING", "SURVEYING", "ARCHITECTURE", "CLEANING", "MOVING", "SECURITY_INSTALLATION",
] as const;

/** Translated labels for backend category / status codes; unknown codes fall back to the raw code. */
export function useTasklnLabels() {
  const t = useTranslations("TasklnLabels");
  return {
    category: (code: string) => (t.has(`category.${code}`) ? t(`category.${code}`) : code),
    status: (code: string) => (t.has(`status.${code}`) ? t(`status.${code}`) : code),
  };
}
