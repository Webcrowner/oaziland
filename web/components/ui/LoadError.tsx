"use client";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import Button from "@/components/ui/Button";

export default function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTranslations("ErrorBoundary");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div role="alert" className="my-4 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
      <p className="mb-3">{message}</p>
      <Button type="button" variant="secondary" disabled={pending} onClick={() => onRetry ? onRetry() : startTransition(() => router.refresh())}>
        {t("retry")}
      </Button>
    </div>
  );
}
