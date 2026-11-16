import type { GoodsVariant, GoodsVariantInput } from "@/lib/api";

export type VariantSelection = Record<string, string>;

/** The option names of a listing in their display order (every version carries the same names). */
export function variantOptionNames(variants: GoodsVariant[]): string[] {
  return variants.length > 0 ? Object.keys(variants[0].options) : [];
}

/** The distinct values offered for one option name, in first-seen order. */
export function variantOptionValues(variants: GoodsVariant[], name: string): string[] {
  const seen: string[] = [];
  for (const variant of variants) {
    const value = variant.options[name];
    if (value !== undefined && !seen.includes(value)) seen.push(value);
  }
  return seen;
}

const matches = (variant: GoodsVariant, selection: VariantSelection) =>
  Object.entries(selection).every(([name, value]) => variant.options[name] === value);

/** The version picked by a complete selection (a value for every option name), or null. */
export function findVariant(variants: GoodsVariant[], selection: VariantSelection): GoodsVariant | null {
  const names = variantOptionNames(variants);
  if (names.length === 0 || names.some((name) => !selection[name])) return null;
  return variants.find((variant) => matches(variant, selection)) ?? null;
}

/** A value can be picked while at least one in-stock version has it. */
export function isValueAvailable(variants: GoodsVariant[], name: string, value: string): boolean {
  return variants.some((variant) => variant.available && variant.options[name] === value);
}

/**
 * The selection after tapping `value` for `name`. Earlier choices that no in-stock version can combine with it
 * are dropped, so a buyer never has to un-pick one option before choosing another.
 */
export function selectVariantValue(variants: GoodsVariant[], selection: VariantSelection, name: string, value: string): VariantSelection {
  const next: VariantSelection = { [name]: value };
  for (const [otherName, otherValue] of Object.entries(selection)) {
    if (otherName === name) continue;
    const candidate = { ...next, [otherName]: otherValue };
    if (variants.some((variant) => variant.available && matches(variant, candidate))) next[otherName] = otherValue;
  }
  return Object.fromEntries(variantOptionNames(variants).filter((n) => next[n] !== undefined).map((n) => [n, next[n]]));
}

/** How many are left when it is worth telling the buyer (3 or fewer), else null. */
export function lowStockCount(quantity: number, threshold = 3): number | null {
  return quantity > 0 && quantity <= threshold ? quantity : null;
}

export const MAX_VARIANTS = 60;
export const MAX_VARIANT_STOCK = 100000;

/** One editable row of the seller's options table; `values` lines up with the option names. */
export interface VariantRow {
  key: string;
  id?: string;
  values: string[];
  delta: string;
  quantity: string;
  sku: string;
  photo: string;
  active: boolean;
}

export type VariantEditorError = {
  index?: number;
  code: "nameRequired" | "nameDuplicate" | "valueRequired" | "comboDuplicate" | "deltaInvalid" | "quantityInvalid" | "tooMany" | "priceTooLow";
};

/** The editor's names and rows for an existing set of versions. */
export function rowsFromVariants(variants: GoodsVariant[]): { names: string[]; rows: VariantRow[] } {
  const names = variantOptionNames(variants);
  return {
    names: names.length > 0 ? names : [""],
    rows: variants.map((variant) => ({
      key: variant.id, id: variant.id, values: names.map((name) => variant.options[name] ?? ""),
      delta: String(Math.round(Number(variant.price_delta_xaf) || 0)), quantity: String(variant.quantity), sku: variant.sku,
      photo: variant.photo_url ?? "", active: variant.is_active,
    })),
  };
}

/** Everything that would make the server reject the table, found before sending it. */
export function validateVariantRows(names: string[], rows: VariantRow[], basePrice: number): VariantEditorError[] {
  const errors: VariantEditorError[] = [];
  const trimmed = names.map((name) => name.trim());
  if (rows.length === 0) return errors;
  if (trimmed.some((name) => !name)) errors.push({ code: "nameRequired" });
  else if (new Set(trimmed.map((name) => name.toLowerCase())).size !== trimmed.length) errors.push({ code: "nameDuplicate" });
  if (rows.length > MAX_VARIANTS) errors.push({ code: "tooMany" });
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (row.values.some((value) => !value.trim())) errors.push({ index, code: "valueRequired" });
    const combo = row.values.map((value) => value.trim().toLowerCase()).join("\u0000");
    if (seen.has(combo)) errors.push({ index, code: "comboDuplicate" });
    seen.add(combo);
    const delta = Number(row.delta === "" ? 0 : row.delta);
    if (!Number.isInteger(delta)) errors.push({ index, code: "deltaInvalid" });
    else if (basePrice + delta <= 0) errors.push({ index, code: "priceTooLow" });
    const quantity = Number(row.quantity);
    if (row.quantity === "" || !Number.isInteger(quantity) || quantity < 0 || quantity > MAX_VARIANT_STOCK) errors.push({ index, code: "quantityInvalid" });
  });
  return errors;
}

/** The request body rows for the editor's table. */
export function variantRowsToInputs(names: string[], rows: VariantRow[]): GoodsVariantInput[] {
  const trimmed = names.map((name) => name.trim());
  return rows.map((row) => ({
    ...(row.id ? { id: row.id } : {}),
    options: Object.fromEntries(trimmed.map((name, i) => [name, row.values[i].trim()])),
    price_delta_xaf: Number(row.delta === "" ? 0 : row.delta),
    quantity: Number(row.quantity),
    ...(row.sku.trim() ? { sku: row.sku.trim() } : {}),
    ...(row.photo ? { photo_url: row.photo } : {}),
    is_active: row.active,
  }));
}
