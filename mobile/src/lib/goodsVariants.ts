import type { GoodsVariant } from "./api";
import type { SaleFields } from "./flashSale";

/** The value chosen for each option name, e.g. { Colour: "Red", Size: "M" }. */
export type VariantSelection = Record<string, string>;

/** The price fields of one version, shaped like a listing so the usual price display can show it. */
export function variantPriceFields(listing: SaleFields, variant: GoodsVariant): SaleFields {
  return {
    ...listing,
    has_variants: false,
    price_xaf: String(Number(listing.price_xaf) + Number(variant.price_delta_xaf)),
    current_price_xaf: variant.price_xaf,
  };
}

/** The option names in the order the seller set them (every version uses the same names). */
export function optionNames(variants: GoodsVariant[]): string[] {
  return variants.length > 0 ? Object.keys(variants[0].options) : [];
}

/** The distinct values offered for one option name, in the order they first appear. */
export function optionValues(variants: GoodsVariant[], name: string): string[] {
  const values: string[] = [];
  for (const variant of variants) {
    const value = variant.options[name];
    if (value !== undefined && !values.includes(value)) values.push(value);
  }
  return values;
}

function matches(variant: GoodsVariant, selection: VariantSelection): boolean {
  return Object.entries(selection).every(([name, value]) => variant.options[name] === value);
}

/** Whether some version with these options can be bought right now. */
export function hasAvailable(variants: GoodsVariant[], selection: VariantSelection): boolean {
  return variants.some((variant) => variant.available && matches(variant, selection));
}

/** A value with no version in stock is disabled and labelled "Out of stock". */
export function isValueAvailable(variants: GoodsVariant[], name: string, value: string): boolean {
  return hasAvailable(variants, { [name]: value });
}

/**
 * Picks a value (or un-picks it when tapped again). Choices for the other names are kept only while
 * some version in stock still has them, so every chip that is enabled can always be reached.
 */
export function selectOption(variants: GoodsVariant[], selection: VariantSelection, name: string, value: string): VariantSelection {
  if (selection[name] === value) {
    const { [name]: _removed, ...rest } = selection;
    return rest;
  }
  let next: VariantSelection = { [name]: value };
  for (const other of optionNames(variants)) {
    if (other === name || selection[other] === undefined) continue;
    const candidate = { ...next, [other]: selection[other] };
    if (hasAvailable(variants, candidate)) next = candidate;
  }
  return next;
}

/** The names still without a choice, in order. */
export function missingOptions(variants: GoodsVariant[], selection: VariantSelection): string[] {
  return optionNames(variants).filter((name) => selection[name] === undefined);
}

/** The version that matches a complete selection, or null while something is still to choose. */
export function selectedVariant(variants: GoodsVariant[], selection: VariantSelection): GoodsVariant | null {
  if (variants.length === 0 || missingOptions(variants, selection).length > 0) return null;
  return variants.find((variant) => variant.available && matches(variant, selection)) ?? null;
}

/** "Colour, Size" or "Colour and Size": what to ask the buyer to choose. */
export function missingOptionsText(names: string[], andWord: string): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} ${andWord} ${names[names.length - 1]}`;
}
