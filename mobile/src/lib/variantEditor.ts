import type { GoodsVariant, GoodsVariantInput, GoodsVariantServerError } from "./api";
import type { MessageKey } from "../i18n/messages";

export const MAX_VARIANTS = 60;
export const MAX_OPTION_NAMES = 3;
const MAX_NAME_LENGTH = 30;
const MAX_VALUE_LENGTH = 40;
const MAX_SKU_LENGTH = 40;
const MAX_STOCK = 100_000;

export interface VariantRowDraft {
  id?: string;
  /** One value per option name, in the same order as the names. */
  values: string[];
  quantity: string;
  priceDelta: string;
  sku: string;
  photoUrl: string;
  isActive: boolean;
}

export interface VariantsDraft {
  names: string[];
  rows: VariantRowDraft[];
}

export const EMPTY_VARIANTS_DRAFT: VariantsDraft = { names: [""], rows: [] };

export function emptyRow(valueCount: number): VariantRowDraft {
  return { values: Array.from({ length: valueCount }, () => ""), quantity: "0", priceDelta: "0", sku: "", photoUrl: "", isActive: true };
}

/** The editor's starting point: the listing's current versions, or one blank option name when it has none. */
export function draftFromVariants(variants: GoodsVariant[]): VariantsDraft {
  if (variants.length === 0) return EMPTY_VARIANTS_DRAFT;
  const names = Object.keys(variants[0].options);
  return {
    names,
    rows: variants.map((variant) => ({
      id: variant.id,
      values: names.map((name) => variant.options[name] ?? ""),
      quantity: String(variant.quantity),
      priceDelta: String(Number(variant.price_delta_xaf)),
      sku: variant.sku ?? "",
      photoUrl: variant.photo_url ?? "",
      isActive: variant.is_active,
    })),
  };
}

export function addOptionName(draft: VariantsDraft): VariantsDraft {
  if (draft.names.length >= MAX_OPTION_NAMES) return draft;
  return { names: [...draft.names, ""], rows: draft.rows.map((row) => ({ ...row, values: [...row.values, ""] })) };
}

export function removeOptionName(draft: VariantsDraft, index: number): VariantsDraft {
  if (draft.names.length <= 1) return draft;
  return {
    names: draft.names.filter((_, i) => i !== index),
    rows: draft.rows.map((row) => ({ ...row, values: row.values.filter((_, i) => i !== index) })),
  };
}

export function addRow(draft: VariantsDraft): VariantsDraft {
  if (draft.rows.length >= MAX_VARIANTS) return draft;
  return { ...draft, rows: [...draft.rows, emptyRow(draft.names.length)] };
}

export function rowLabel(row: VariantRowDraft): string {
  return row.values.map((value) => value.trim()).join(" / ");
}

export function totalStock(draft: VariantsDraft): number {
  return draft.rows.reduce((sum, row) => (row.isActive && /^\d+$/.test(row.quantity.trim()) ? sum + Number(row.quantity) : sum), 0);
}

/** What one version sells at: the listing's price plus its difference. */
export function rowPriceXaf(basePriceXaf: number, row: VariantRowDraft): number {
  const delta = row.priceDelta.trim() === "" ? 0 : Number(row.priceDelta);
  return basePriceXaf + (Number.isFinite(delta) ? delta : 0);
}

export interface VariantIssue {
  /** The row it belongs to, or null when it is about the option names or the set as a whole. */
  index: number | null;
  key: MessageKey;
}

/** The first thing wrong with the draft, caught before the request (the server checks again). */
export function variantsDraftError(draft: VariantsDraft, basePriceXaf: number): VariantIssue | null {
  const names = draft.names.map((name) => name.trim());
  if (names.length < 1 || names.length > MAX_OPTION_NAMES || names.some((name) => !name)) return { index: null, key: "variants.error.noNames" };
  if (names.some((name) => name.length > MAX_NAME_LENGTH)) return { index: null, key: "variants.error.nameLong" };
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) return { index: null, key: "variants.error.nameTwice" };
  if (draft.rows.length === 0) return { index: null, key: "variants.error.noRows" };
  if (draft.rows.length > MAX_VARIANTS) return { index: null, key: "variants.error.tooMany" };

  const labels = new Set<string>();
  const skus = new Set<string>();
  for (let index = 0; index < draft.rows.length; index += 1) {
    const row = draft.rows[index];
    const values = row.values.map((value) => value.trim());
    if (values.length !== names.length || values.some((value) => !value || value.length > MAX_VALUE_LENGTH)) return { index, key: "variants.error.value" };
    const label = values.join(" / ").toLowerCase();
    if (labels.has(label)) return { index, key: "variants.error.twice" };
    labels.add(label);
    const stock = row.quantity.trim();
    if (!/^\d+$/.test(stock) || Number(stock) > MAX_STOCK) return { index, key: "variants.error.stock" };
    const delta = row.priceDelta.trim();
    if (delta !== "" && !/^-?\d+$/.test(delta)) return { index, key: "variants.error.delta" };
    if (rowPriceXaf(basePriceXaf, row) <= 0) return { index, key: "variants.error.price" };
    const sku = row.sku.trim().toUpperCase();
    if (sku) {
      if (sku.length > MAX_SKU_LENGTH || skus.has(sku)) return { index, key: "variants.error.sku" };
      skus.add(sku);
    }
  }
  return null;
}

/** The body for the replace-all request; a row that has an id keeps it so its history and stock carry over. */
export function variantsPayload(draft: VariantsDraft): GoodsVariantInput[] {
  const names = draft.names.map((name) => name.trim());
  return draft.rows.map((row) => {
    const options: Record<string, string> = {};
    names.forEach((name, i) => { options[name] = (row.values[i] ?? "").trim(); });
    return {
      ...(row.id ? { id: row.id } : {}),
      options,
      price_delta_xaf: row.priceDelta.trim() === "" ? 0 : Number(row.priceDelta),
      quantity: Number(row.quantity),
      sku: row.sku.trim(),
      photo_url: row.photoUrl,
      is_active: row.isActive,
    };
  });
}

export interface GroupedVariantErrors {
  general: string[];
  rows: Record<number, string[]>;
}

/** Splits the server's problems into those for one row and those for the whole set. */
export function groupVariantErrors(errors: GoodsVariantServerError[]): GroupedVariantErrors {
  const grouped: GroupedVariantErrors = { general: [], rows: {} };
  for (const error of errors) {
    if (typeof error.index === "number") (grouped.rows[error.index] ||= []).push(error.message);
    else grouped.general.push(error.message);
  }
  return grouped;
}
