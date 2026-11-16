import { describe, expect, it } from "vitest";
import type { GoodsVariant } from "./api";
import {
  findVariant, isValueAvailable, lowStockCount, rowsFromVariants, selectVariantValue, validateVariantRows, variantOptionNames, variantOptionValues,
  variantRowsToInputs, type VariantRow,
} from "./goodsVariants";

const make = (id: string, Colour: string, Size: string, quantity: number): GoodsVariant => ({
  id, label: `${Colour} / ${Size}`, options: { Colour, Size }, sku: id, price_xaf: "5000", price_delta_xaf: "0",
  quantity, available: quantity > 0, photo_url: null, is_active: true,
});

const variants = [make("a", "Red", "M", 2), make("b", "Red", "L", 0), make("c", "Blue", "M", 0), make("d", "Blue", "L", 5)];

describe("goods variants", () => {
  it("lists option names and values in order", () => {
    expect(variantOptionNames(variants)).toEqual(["Colour", "Size"]);
    expect(variantOptionValues(variants, "Size")).toEqual(["M", "L"]);
    expect(variantOptionNames([])).toEqual([]);
  });

  it("finds a version only for a complete selection", () => {
    expect(findVariant(variants, { Colour: "Blue", Size: "L" })?.id).toBe("d");
    expect(findVariant(variants, { Colour: "Blue" })).toBeNull();
  });

  it("flags values with no stock left anywhere", () => {
    const onlyRedM = [make("a", "Red", "M", 1), make("b", "Blue", "M", 0)];
    expect(isValueAvailable(onlyRedM, "Colour", "Blue")).toBe(false);
    expect(isValueAvailable(onlyRedM, "Colour", "Red")).toBe(true);
  });

  it("drops earlier choices that cannot combine with the new value", () => {
    expect(selectVariantValue(variants, { Colour: "Red", Size: "M" }, "Colour", "Blue")).toEqual({ Colour: "Blue" });
    expect(selectVariantValue(variants, { Colour: "Red" }, "Size", "M")).toEqual({ Colour: "Red", Size: "M" });
  });

  it("only warns about low stock at 3 or fewer", () => {
    expect(lowStockCount(2)).toBe(2);
    expect(lowStockCount(4)).toBeNull();
    expect(lowStockCount(0)).toBeNull();
  });
});

describe("options editor", () => {
  const row = (values: string[], over: Partial<VariantRow> = {}): VariantRow => ({
    key: values.join("-"), values, delta: "0", quantity: "3", sku: "", photo: "", active: true, ...over,
  });

  it("round-trips existing versions into editor rows and request rows", () => {
    const { names, rows } = rowsFromVariants([make("a", "Red", "M", 2)]);
    expect(names).toEqual(["Colour", "Size"]);
    expect(variantRowsToInputs(names, rows)).toEqual([
      { id: "a", options: { Colour: "Red", Size: "M" }, price_delta_xaf: 0, quantity: 2, sku: "a", is_active: true },
    ]);
  });

  it("accepts a valid table and an empty one", () => {
    expect(validateVariantRows(["Size"], [row(["S"]), row(["M"], { delta: "-500" })], 5000)).toEqual([]);
    expect(validateVariantRows([""], [], 5000)).toEqual([]);
  });

  it("reports missing names and values, duplicates, bad numbers and a final price at or below 0", () => {
    expect(validateVariantRows([" "], [row(["S"])], 5000)).toEqual([{ code: "nameRequired" }]);
    expect(validateVariantRows(["Size", "size"], [row(["S", "x"])], 5000)).toEqual([{ code: "nameDuplicate" }]);
    const codes = validateVariantRows(["Size"], [row([""]), row(["S"]), row([" s "], { delta: "1.5", quantity: "-1" })], 5000);
    expect(codes).toEqual([
      { index: 0, code: "valueRequired" },
      { index: 2, code: "comboDuplicate" },
      { index: 2, code: "deltaInvalid" },
      { index: 2, code: "quantityInvalid" },
    ]);
    expect(validateVariantRows(["Size"], [row(["S"], { delta: "-5000" })], 5000)).toEqual([{ index: 0, code: "priceTooLow" }]);
  });
});
