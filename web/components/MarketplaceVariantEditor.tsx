"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { getGoodsVariants, saveGoodsVariants, GoodsVariantsError, type GoodsVariant, type GoodsVariantFieldError } from "@/lib/api";
import {
  MAX_VARIANTS, MAX_VARIANT_STOCK, rowsFromVariants, validateVariantRows, variantRowsToInputs, type VariantEditorError, type VariantRow,
} from "@/lib/goodsVariants";
import MediaUploader from "@/components/MediaUploader";

const MAX_OPTION_NAMES = 3;

/** Sizes, colours and other versions of one goods item, each with its own stock, price difference and SKU. Saving replaces the whole set. */
export default function MarketplaceVariantEditor({
  listingId, basePriceXaf, onSaved,
}: {
  listingId: string;
  /** The listing's current price, to preview each version's final price. */
  basePriceXaf: number;
  onSaved: (result: { variants: GoodsVariant[]; quantity: number }) => void;
}) {
  const t = useTranslations("MarketplaceVariants");
  const [names, setNames] = useState<string[]>([""]);
  const [rows, setRows] = useState<VariantRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  // How many versions are stored on the server, so an emptied table can still be saved (removing every option).
  const [storedCount, setStoredCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState("");
  const [serverErrors, setServerErrors] = useState<GoodsVariantFieldError[]>([]);
  const [localErrors, setLocalErrors] = useState<VariantEditorError[]>([]);
  const counter = useRef(0);
  const nextKey = () => `new-${(counter.current += 1)}`;

  useEffect(() => {
    const token = localStorage.getItem("access_token") ?? undefined;
    getGoodsVariants(listingId, token)
      .then((variants) => {
        const draft = rowsFromVariants(variants);
        setNames(draft.names);
        setRows(draft.rows);
        setStoredCount(variants.length);
      })
      .catch((err: unknown) => setProblem(err instanceof Error ? err.message : t("loadFailed")))
      .finally(() => setLoaded(true));
  }, [listingId, t]);

  const touch = () => {
    setSaved(false);
    setProblem("");
    setServerErrors([]);
    setLocalErrors([]);
  };
  const updateRow = (key: string, patch: Partial<VariantRow>) => {
    touch();
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };
  const setValue = (key: string, position: number, value: string) => {
    touch();
    setRows((current) => current.map((row) => (row.key === key ? { ...row, values: row.values.map((v, i) => (i === position ? value : v)) } : row)));
  };
  const addRow = () => {
    touch();
    setRows((current) => [...current, { key: nextKey(), values: names.map(() => ""), delta: "0", quantity: "1", sku: "", photo: "", active: true }]);
  };
  const addName = () => {
    touch();
    setNames((current) => [...current, ""]);
    setRows((current) => current.map((row) => ({ ...row, values: [...row.values, ""] })));
  };
  const removeName = (position: number) => {
    touch();
    setNames((current) => current.filter((_, i) => i !== position));
    setRows((current) => current.map((row) => ({ ...row, values: row.values.filter((_, i) => i !== position) })));
  };

  async function persist(variantRows: VariantRow[]) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBusy(true);
    touch();
    try {
      const result = await saveGoodsVariants(listingId, variantRowsToInputs(names, variantRows), token);
      const draft = rowsFromVariants(result.variants);
      setNames(draft.names);
      setRows(draft.rows);
      setStoredCount(result.variants.length);
      setSaved(true);
      onSaved(result);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : t("saveFailed"));
      if (err instanceof GoodsVariantsError) setServerErrors(err.errors);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const errors = validateVariantRows(names, rows, basePriceXaf);
    setLocalErrors(errors);
    setSaved(false);
    if (errors.length > 0) {
      setProblem(t("fixErrors"));
      return;
    }
    await persist(rows);
  }

  async function removeAll() {
    if (!window.confirm(t("confirmRemoveAll"))) return;
    await persist([]);
  }

  const errorsFor = (index: number) => [
    ...localErrors.filter((e) => e.index === index).map((e) => t(`error_${e.code}`)),
    ...serverErrors.filter((e) => e.index === index).map((e) => e.message),
  ];
  const generalErrors = [
    ...localErrors.filter((e) => e.index === undefined).map((e) => t(`error_${e.code}`)),
    ...serverErrors.filter((e) => e.index === undefined).map((e) => e.message),
  ];
  const input = "min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900";
  const smallLabel = "flex min-w-0 flex-col gap-1 text-xs font-semibold text-slate-600";

  if (!loaded) return <p className="text-sm text-slate-400">...</p>;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3" aria-label={t("title")}>
      <div>
        <h3 className="text-sm font-bold text-slate-900">{t("title")}</h3>
        <p className="text-xs text-slate-600">{t("help")}</p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-slate-600">{t("namesLegend")}</p>
        <div className="flex flex-wrap gap-2">
          {names.map((name, position) => (
            <div key={position} className="flex min-w-0 items-center gap-1">
              <input
                value={name} onChange={(e) => { touch(); setNames((current) => current.map((n, i) => (i === position ? e.target.value : n))); }}
                maxLength={40} placeholder={t(position === 0 ? "namePlaceholder1" : position === 1 ? "namePlaceholder2" : "namePlaceholder3")}
                aria-label={t("optionName", { n: position + 1 })} className={`${input} w-36`}
              />
              {names.length > 1 && (
                <button type="button" onClick={() => removeName(position)} aria-label={t("removeOptionName", { n: position + 1 })} className="h-11 w-11 shrink-0 rounded-lg text-lg font-bold text-red-700 cursor-pointer">×</button>
              )}
            </div>
          ))}
          {names.length < MAX_OPTION_NAMES && (
            <button type="button" onClick={addName} className="min-h-11 rounded-lg border border-dashed border-slate-400 px-3 text-sm font-semibold text-slate-700 cursor-pointer">+ {t("addOptionName")}</button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg bg-white px-3 py-2 text-sm text-slate-500">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row, index) => {
            const delta = Number(row.delta === "" ? 0 : row.delta);
            const finalPrice = basePriceXaf + (Number.isFinite(delta) ? delta : 0);
            const rowErrors = errorsFor(index);
            return (
              <li key={row.key} className={`rounded-xl border bg-white p-3 ${rowErrors.length > 0 ? "border-red-300" : "border-slate-200"} ${row.active ? "" : "opacity-70"}`}>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                  {names.map((name, position) => (
                    <label key={position} className={smallLabel}>
                      {name.trim() || t("optionName", { n: position + 1 })}
                      <input value={row.values[position] ?? ""} onChange={(e) => setValue(row.key, position, e.target.value)} maxLength={40} className={input} />
                    </label>
                  ))}
                  <label className={smallLabel}>
                    {t("priceDifference")}
                    <input type="number" inputMode="numeric" step="1" value={row.delta} onChange={(e) => updateRow(row.key, { delta: e.target.value })} className={input} />
                    <span className={`font-normal ${finalPrice > 0 ? "text-slate-500" : "text-red-700"}`}>{t("finalPrice", { price: finalPrice.toLocaleString() })}</span>
                  </label>
                  <label className={smallLabel}>
                    {t("stock")}
                    <input type="number" inputMode="numeric" min="0" max={MAX_VARIANT_STOCK} step="1" value={row.quantity} onChange={(e) => updateRow(row.key, { quantity: e.target.value })} className={input} />
                  </label>
                  <label className={smallLabel}>
                    {t("sku")}
                    <input value={row.sku} onChange={(e) => updateRow(row.key, { sku: e.target.value })} maxLength={60} placeholder={t("skuAuto")} className={input} />
                  </label>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {row.photo ? (
                    <span className="flex items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={row.photo} alt="" className="h-11 w-11 rounded-lg object-cover" />
                      <button type="button" onClick={() => updateRow(row.key, { photo: "" })} className="min-h-10 text-sm font-semibold text-red-700 underline cursor-pointer">{t("removePhoto")}</button>
                    </span>
                  ) : (
                    <MediaUploader folder="marketplace" multiple={false} accept="image/*" label={`📷 ${t("addPhoto")}`} onUploaded={(m) => updateRow(row.key, { photo: m.url })} />
                  )}
                  <label className="flex min-h-10 items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={row.active} onChange={(e) => updateRow(row.key, { active: e.target.checked })} className="h-4 w-4" /> {t("active")}
                  </label>
                  <button
                    type="button" onClick={() => { touch(); setRows((current) => current.filter((r) => r.key !== row.key)); }}
                    className="ml-auto min-h-10 text-sm font-semibold text-red-700 underline cursor-pointer"
                  >
                    {t("removeRow")}
                  </button>
                </div>
                {rowErrors.length > 0 && (
                  <ul role="alert" className="mt-2 list-disc pl-5 text-xs text-red-700">
                    {rowErrors.map((message, i) => <li key={i}>{message}</li>)}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {generalErrors.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-sm text-red-700">
          {generalErrors.map((message, i) => <li key={i}>{message}</li>)}
        </ul>
      )}
      {problem && <p role="alert" className="text-sm text-red-700">{problem}</p>}
      {saved && <p role="status" className="text-sm font-semibold text-green-700">{t("saved")}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button" onClick={addRow} disabled={rows.length >= MAX_VARIANTS || busy}
          className="min-h-11 rounded-lg border border-[var(--navy)] px-4 text-sm font-semibold text-[var(--navy)] disabled:opacity-50 cursor-pointer"
        >
          + {t("addRow")}
        </button>
        <button
          type="button" onClick={save} disabled={busy || (rows.length === 0 && storedCount === 0)}
          className="min-h-11 rounded-lg bg-[var(--navy)] px-4 text-sm font-semibold text-white disabled:opacity-50 cursor-pointer"
        >
          {busy ? t("saving") : t("save")}
        </button>
        {rows.length > 0 && (
          <button type="button" onClick={removeAll} disabled={busy} className="min-h-10 text-sm font-semibold text-red-700 underline disabled:opacity-50 cursor-pointer">{t("removeAll")}</button>
        )}
      </div>
    </section>
  );
}
