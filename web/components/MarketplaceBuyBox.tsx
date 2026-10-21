"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { getMyProfile, placeMarketplaceOrder, type MarketplaceCategory } from "@/lib/api";

/** Pay for a marketplace listing into escrow; the seller is only paid once the buyer confirms receipt. */
export default function MarketplaceBuyBox({
  category, listingId, ownerId, availability, isSale, amount,
}: {
  category: MarketplaceCategory;
  listingId: string;
  ownerId?: string;
  availability: string;
  isSale: boolean;
  amount: string;
}) {
  const t = useTranslations("MarketplaceBuyBox");
  const router = useRouter();
  const [state, setState] = useState<"loading" | "signedOut" | "owner" | "buyer">("loading");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [placed, setPlaced] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    const lookup: Promise<"owner" | "buyer" | "signedOut"> = token
      ? getMyProfile(token).then((profile) => (profile.id === ownerId ? "owner" : "buyer")).catch(() => "signedOut" as const)
      : Promise.resolve("signedOut" as const);
    lookup.then(setState);
  }, [ownerId]);

  if (state === "loading") return null;
  if (state === "owner") {
    return (
      <div className="rounded-lg p-4 bg-gray-50 border border-gray-200 text-sm text-gray-700">
        <p className="mb-2">{t("yourListing")}</p>
        <Link href="/marketplace/my-listings" className="font-semibold text-[var(--navy)] underline">{t("manageListing")}</Link>
      </div>
    );
  }
  if (placed) {
    return (
      <div className="rounded-lg p-4 bg-green-50 border border-green-200 text-sm text-green-800">
        <p className="font-semibold mb-1">{t("placedTitle")}</p>
        <p className="mb-2">{t("placedBody")}</p>
        <Link href="/marketplace/orders" className="font-semibold text-[var(--navy)] underline">{t("viewOrders")}</Link>
      </div>
    );
  }
  if (availability !== "AVAILABLE") {
    return <div className="rounded-lg p-4 bg-gray-50 border border-gray-200 text-sm text-gray-700">{t("notAvailable")}</div>;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      await placeMarketplaceOrder(category, listingId, phone.trim(), token);
      setPlaced(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg p-4 bg-white border border-[var(--gold)]">
      <h2 className="font-bold text-[var(--navy)] mb-1">{isSale ? t("buyTitle") : t("rentTitle")}</h2>
      <p className="text-xs text-gray-600 mb-3">{t("escrowExplainer")}</p>
      {state === "signedOut" ? (
        <Link href="/login" className="inline-block bg-[var(--navy)] text-white font-semibold px-4 py-2 rounded-lg text-sm">{t("signIn")}</Link>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <input
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t("phonePlaceholder")}
            aria-label={t("phonePlaceholder")}
            className="border rounded-lg px-3 py-2 text-sm"
          />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={busy || !phone.trim()}
            className="bg-[var(--navy)] text-white font-semibold px-4 py-2.5 rounded-lg text-sm disabled:opacity-50 cursor-pointer"
          >
            {busy ? t("paying") : t("payButton", { amount })}
          </button>
        </form>
      )}
    </div>
  );
}
