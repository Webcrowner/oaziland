"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  createMarketplaceListing, addMarketplaceMedia, listQuarters, GOODS_CATEGORIES, GOODS_CONDITIONS,
  type GoodsCategory, type GoodsCondition, type Quarter, type MediaUploadResult,
} from "@/lib/api";
import MediaUploader from "@/components/MediaUploader";
import MediaThumbs from "@/components/MediaThumbs";
import QuarterOptions from "@/components/QuarterOptions";
import MissingAreaRequest from "@/components/MissingAreaRequest";
import LocationCapture, { EMPTY_GPS, type GpsValue } from "@/components/LocationCapture";

const OTHER_CATEGORIES = [
  { href: "/marketplace/cars?post=1", icon: "🚗", key: "cars" },
  { href: "/marketplace/stores?post=1", icon: "🏬", key: "stores" },
  { href: "/marketplace/warehouses?post=1", icon: "🏭", key: "warehouses" },
  { href: "/marketplace/businesses?post=1", icon: "💼", key: "businesses" },
] as const;

const MAX_MEDIA = 20;

/** Pulls a readable message out of the JSON error text createMarketplaceListing throws. */
function errorMessage(error: unknown, fallback: string): string {
  try {
    const data = JSON.parse((error as Error).message);
    if (typeof data.detail === "string") return data.detail;
    const first = Object.values(data).flat()[0];
    if (typeof first === "string") return first;
  } catch {
    // Not a JSON API error — fall through to the generic message.
  }
  return fallback;
}

/** Post an everyday item for sale. Mobile-first: one column, big tap targets, photos first. */
export default function SellPage() {
  const t = useTranslations("MarketplaceSell");
  const tg = useTranslations("MarketplaceGoods");
  const tp = useTranslations("MarketplacePage");
  const router = useRouter();
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [title, setTitle] = useState("");
  const [itemCategory, setItemCategory] = useState<GoodsCategory | "">("");
  const [condition, setCondition] = useState<GoodsCondition>("USED");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [quarterId, setQuarterId] = useState("");
  const [description, setDescription] = useState("");
  const [gps, setGps] = useState<GpsValue>(EMPTY_GPS);
  const [status, setStatus] = useState<"idle" | "submitting">("idle");
  const [error, setError] = useState("");
  const [signedIn, setSignedIn] = useState(true);

  useEffect(() => {
    listQuarters().then(setQuarters).catch(() => {});
    Promise.resolve().then(() => setSignedIn(Boolean(localStorage.getItem("access_token"))));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    setStatus("submitting");
    setError("");
    try {
      const listing = await createMarketplaceListing("goods", {
        title: title.trim(), description: description.trim(), price_basis: "SALE", price_xaf: price,
        item_category: itemCategory, condition, quantity: Number(quantity) || 1, quarter: quarterId || null,
        latitude: gps.latitude, longitude: gps.longitude,
      }, token);
      // The listing exists now, so a file that fails to attach must not make the seller post the item twice;
      // the listing page tells them how many were missed and lets them add those again.
      let failed = 0;
      for (const m of media) {
        await addMarketplaceMedia("goods", listing.id, m.url, m.media_type, token).catch(() => { failed += 1; });
      }
      router.push(`/marketplace/goods/${listing.id}${failed ? `?mediaFailed=${failed}` : ""}`);
    } catch (err) {
      setError(errorMessage(err, t("submitFailed")));
      setStatus("idle");
    }
  }

  const field = "w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-base focus:border-[var(--gold)] focus:outline-none";
  const label = "mb-1.5 block text-sm font-semibold text-slate-700";

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 md:py-10">
      <Link href="/marketplace" className="mb-4 inline-block text-sm font-semibold text-slate-500 hover:text-[var(--navy)]">← {t("back")}</Link>
      <h1 className="mb-1 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[var(--navy)] md:text-3xl">{t("title")}</h1>
      <p className="mb-6 text-sm text-slate-500 md:text-base">{t("subtitle")}</p>

      {!signedIn && (
        <p className="mb-5 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t("signInNeeded")} <Link href="/login" className="font-bold underline">{t("signIn")}</Link>
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">{t("photos")}</span>
            <span className="text-xs font-medium text-slate-500">{t("mediaCount", { count: media.length, max: MAX_MEDIA })}</span>
          </div>
          {media.length < MAX_MEDIA ? (
            <MediaUploader
              folder="marketplace"
              onUploaded={(m) => setMedia((prev) => (prev.length >= MAX_MEDIA ? prev : [...prev, m]))}
              label={`📷 ${media.length === 0 ? t("addPhotos") : t("addMore")}`}
            />
          ) : (
            <p className="text-sm font-semibold text-amber-700">{t("mediaFull", { max: MAX_MEDIA })}</p>
          )}
          <MediaThumbs
            items={media.map((m) => ({ url: m.url, media_type: m.media_type }))}
            onRemove={(i) => setMedia((prev) => prev.filter((_, idx) => idx !== i))}
          />
          <p className="mt-1 text-xs text-slate-500">{t("photosHint", { max: MAX_MEDIA })}</p>
        </div>

        <div>
          <label htmlFor="sell-title" className={label}>{t("itemTitle")}</label>
          <input id="sell-title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("itemTitlePlaceholder")} className={field} />
        </div>

        <div>
          <label htmlFor="sell-category" className={label}>{t("category")}</label>
          <select id="sell-category" required value={itemCategory} onChange={(e) => setItemCategory(e.target.value as GoodsCategory)} className={field}>
            <option value="" disabled>{t("chooseCategory")}</option>
            {GOODS_CATEGORIES.map((c) => <option key={c} value={c}>{tg(`cat_${c}`)}</option>)}
          </select>
        </div>

        <fieldset>
          <legend className={label}>{t("condition")}</legend>
          <div className="grid grid-cols-3 gap-2">
            {GOODS_CONDITIONS.map((c) => (
              <label
                key={c}
                className={`cursor-pointer rounded-xl border px-2 py-3 text-center text-sm font-semibold transition-colors ${
                  condition === c ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-slate-300 bg-white text-slate-700"
                }`}
              >
                <input type="radio" name="condition" value={c} checked={condition === c} onChange={() => setCondition(c)} className="sr-only" />
                {tg(`cond_${c}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="sell-price" className={label}>{t("price")}</label>
            <input id="sell-price" required type="number" inputMode="decimal" min="1" step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="25000" className={field} />
          </div>
          <div>
            <label htmlFor="sell-quantity" className={label}>{t("quantity")}</label>
            <input id="sell-quantity" required type="number" inputMode="numeric" min="1" max="100000" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={field} />
          </div>
        </div>

        <div>
          <label htmlFor="sell-quarter" className={label}>{t("neighborhood")}</label>
          <select id="sell-quarter" required value={quarterId} onChange={(e) => setQuarterId(e.target.value)} className={field}>
            <option value="" disabled>{t("chooseNeighborhood")}</option>
            <QuarterOptions quarters={quarters} />
          </select>
          <MissingAreaRequest quarters={quarters} className="mt-2" />
        </div>

        <div>
          <label htmlFor="sell-description" className={label}>{t("description")}</label>
          <textarea id="sell-description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("descriptionPlaceholder")} className={field} />
        </div>

        <LocationCapture value={gps} onChange={setGps} />

        {error && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}

        <button
          type="submit" disabled={status === "submitting"}
          className="w-full rounded-xl gold-gradient px-6 py-3.5 text-base font-bold text-[var(--navy)] transition-all active:scale-[0.98] disabled:opacity-50"
        >
          {status === "submitting" ? t("posting") : t("post")}
        </button>
      </form>

      <section className="mt-8">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-500">{t("somethingElse")}</h2>
        <p className="mb-3 text-sm text-slate-500">{t("somethingElseHint")}</p>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {OTHER_CATEGORIES.map((c) => (
            <Link key={c.key} href={c.href} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 hover:border-[var(--navy)]">
              <span aria-hidden>{c.icon}</span>{tp(c.key)}
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
