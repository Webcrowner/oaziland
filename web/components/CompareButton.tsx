"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { setMyComparison } from "@/lib/api";

const STAGING_KEY = "oaziland_comparison_staging";

/**
 * Adds/removes THIS listing from the comparison set. WHY selections
 * are staged in localStorage first, not sent straight to the backend:
 * create_or_update_comparison() genuinely requires 2-4 listings —
 * sending a single listing the moment someone picks their first one
 * would just fail. Staging locally lets someone pick items one at a
 * time (the real, natural way to build a comparison) and only syncs
 * to the backend once there are enough to actually be valid.
 */
export default function CompareButton({ listingId }: { listingId: string }) {
  const t = useTranslations("ListingDetailPage");
  const router = useRouter();
  const [staged, setStaged] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(STAGING_KEY);
    void Promise.resolve().then(() => setStaged(raw ? JSON.parse(raw) : []));
  }, []);

  const isStaged = staged.includes(listingId);

  async function handleToggle() {
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }

    const next = isStaged ? staged.filter((id) => id !== listingId) : [...staged, listingId].slice(-4);
    setFailed(false);

    if (next.length >= 2) {
      setSaving(true);
      try {
        await setMyComparison(next, token);
        localStorage.setItem(STAGING_KEY, JSON.stringify(next));
        setStaged(next);
      } catch {
        // WHY the local state is never updated on failure: staging
        // locally BEFORE a successful backend sync would show this
        // listing as "in comparison" when the server never actually
        // received it — the UI would silently lie about what's saved.
        setFailed(true);
      } finally {
        setSaving(false);
      }
    } else {
      // Fewer than 2 items never touches the backend at all — always safe to update locally.
      localStorage.setItem(STAGING_KEY, JSON.stringify(next));
      setStaged(next);
    }
  }

  return (
    <div>
      <button onClick={handleToggle} disabled={saving} className="font-semibold px-4 py-2 rounded border border-[var(--navy)] text-[var(--navy)] hover:bg-gray-50 disabled:opacity-50">
        {isStaged ? t("removeFromCompare") : t("compare")}
      </button>
      {failed && <p className="text-red-600 text-xs mt-1">{t("saveFailed")}</p>}
    </div>
  );
}
