import type { GoodsVariant } from "../api";
import {
  hasAvailable, isValueAvailable, missingOptions, missingOptionsText, optionNames, optionValues, selectOption, selectedVariant, variantPriceFields,
} from "../goodsVariants";

function variant(id: string, colour: string, size: string, quantity: number, delta = 0): GoodsVariant {
  return {
    id, label: `${colour} / ${size}`, options: { Colour: colour, Size: size }, sku: id.toUpperCase(),
    price_xaf: String(5000 + delta), price_delta_xaf: String(delta), quantity, available: quantity > 0, photo_url: null, is_active: true,
  };
}

const variants = [variant("a", "Red", "M", 3), variant("b", "Red", "L", 0), variant("c", "Blue", "L", 2, 500), variant("d", "Green", "S", 0)];

describe("options", () => {
  it("lists names and distinct values in order", () => {
    expect(optionNames(variants)).toEqual(["Colour", "Size"]);
    expect(optionValues(variants, "Colour")).toEqual(["Red", "Blue", "Green"]);
    expect(optionValues(variants, "Size")).toEqual(["M", "L", "S"]);
  });

  it("disables a value with nothing in stock", () => {
    expect(isValueAvailable(variants, "Colour", "Red")).toBe(true);
    expect(isValueAvailable(variants, "Colour", "Green")).toBe(false);
    expect(isValueAvailable(variants, "Size", "S")).toBe(false);
    expect(hasAvailable(variants, { Colour: "Red", Size: "L" })).toBe(false);
  });
});

describe("selectOption", () => {
  it("keeps the other choice while some version in stock still has it", () => {
    expect(selectOption(variants, { Size: "L" }, "Colour", "Blue")).toEqual({ Colour: "Blue", Size: "L" });
  });

  it("drops a choice the new value cannot be combined with", () => {
    expect(selectOption(variants, { Size: "M" }, "Colour", "Blue")).toEqual({ Colour: "Blue" });
  });

  it("un-picks a value that is tapped again", () => {
    expect(selectOption(variants, { Colour: "Red", Size: "M" }, "Size", "M")).toEqual({ Colour: "Red" });
  });
});

describe("selectedVariant", () => {
  it("needs every option chosen", () => {
    expect(selectedVariant(variants, { Colour: "Red" })).toBeNull();
    expect(missingOptions(variants, { Colour: "Red" })).toEqual(["Size"]);
    expect(selectedVariant(variants, { Colour: "Red", Size: "M" })?.id).toBe("a");
  });

  it("does not pick a sold-out version", () => {
    expect(selectedVariant(variants, { Colour: "Red", Size: "L" })).toBeNull();
  });
});

describe("missingOptionsText", () => {
  it("joins names for the hint", () => {
    expect(missingOptionsText(["Size"], "and")).toBe("Size");
    expect(missingOptionsText(["Colour", "Size"], "and")).toBe("Colour and Size");
    expect(missingOptionsText(["A", "B", "C"], "et")).toBe("A, B et C");
  });
});

describe("variantPriceFields", () => {
  it("shows the version's final price with the listing's list price plus its difference", () => {
    const fields = variantPriceFields(
      { price_xaf: "5000", on_sale: true, sale_price_xaf: "4000", current_price_xaf: "4000", has_variants: true, price_from_xaf: "4000" },
      variant("c", "Blue", "L", 2, 500),
    );
    expect(fields).toMatchObject({ price_xaf: "5500", current_price_xaf: "5500", has_variants: false });
  });
});
