import type { GoodsVariant } from "../api";
import {
  addOptionName, addRow, draftFromVariants, groupVariantErrors, removeOptionName, totalStock, variantsDraftError, variantsPayload,
  type VariantsDraft,
} from "../variantEditor";

const saved: GoodsVariant[] = [
  { id: "v1", label: "Red / M", options: { Colour: "Red", Size: "M" }, sku: "TEE-1", price_xaf: "5000", price_delta_xaf: "0", quantity: 4, available: true, photo_url: null, is_active: true },
  { id: "v2", label: "Red / L", options: { Colour: "Red", Size: "L" }, sku: "TEE-2", price_xaf: "5500", price_delta_xaf: "500", quantity: 0, available: false, photo_url: "https://x/l.jpg", is_active: false },
];

const draft: VariantsDraft = {
  names: ["Colour", "Size"],
  rows: [
    { values: ["Red", "M"], quantity: "4", priceDelta: "0", sku: "", photoUrl: "", isActive: true },
    { values: ["Red", "L"], quantity: "2", priceDelta: "-500", sku: "tee-2", photoUrl: "", isActive: true },
  ],
};

describe("draftFromVariants", () => {
  it("rebuilds names and rows from the saved versions, keeping ids", () => {
    const loaded = draftFromVariants(saved);
    expect(loaded.names).toEqual(["Colour", "Size"]);
    expect(loaded.rows[1]).toMatchObject({ id: "v2", values: ["Red", "L"], quantity: "0", priceDelta: "500", photoUrl: "https://x/l.jpg", isActive: false });
  });

  it("starts with one blank option name when there are no versions", () => {
    expect(draftFromVariants([]).names).toEqual([""]);
  });
});

describe("editing the shape", () => {
  it("adds and removes an option name in every row, within 1 to 3 names", () => {
    const three = addOptionName(draft);
    expect(three.names).toHaveLength(3);
    expect(three.rows[0].values).toEqual(["Red", "M", ""]);
    expect(addOptionName(three).names).toHaveLength(3);
    expect(removeOptionName(three, 0).rows[0].values).toEqual(["M", ""]);
    expect(removeOptionName({ names: ["Size"], rows: [] }, 0).names).toEqual(["Size"]);
  });

  it("adds a blank version with a value slot per name", () => {
    expect(addRow(draft).rows[2].values).toEqual(["", ""]);
  });
});

describe("variantsDraftError", () => {
  it("accepts a good draft", () => {
    expect(variantsDraftError(draft, 5000)).toBeNull();
  });

  it("checks the option names", () => {
    expect(variantsDraftError({ ...draft, names: ["Colour", " "] }, 5000)).toEqual({ index: null, key: "variants.error.noNames" });
    expect(variantsDraftError({ ...draft, names: ["Size", "size"] }, 5000)).toEqual({ index: null, key: "variants.error.nameTwice" });
    expect(variantsDraftError({ names: ["Size"], rows: [] }, 5000)).toEqual({ index: null, key: "variants.error.noRows" });
  });

  it("points at the row that is wrong", () => {
    const row = draft.rows[1];
    expect(variantsDraftError({ ...draft, rows: [draft.rows[0], { ...row, values: ["red", " m "] }] }, 5000)).toEqual({ index: 1, key: "variants.error.twice" });
    expect(variantsDraftError({ ...draft, rows: [draft.rows[0], { ...row, values: ["Red", ""] }] }, 5000)).toEqual({ index: 1, key: "variants.error.value" });
    expect(variantsDraftError({ ...draft, rows: [draft.rows[0], { ...row, quantity: "1.5" }] }, 5000)).toEqual({ index: 1, key: "variants.error.stock" });
    expect(variantsDraftError({ ...draft, rows: [draft.rows[0], { ...row, quantity: "100001" }] }, 5000)).toEqual({ index: 1, key: "variants.error.stock" });
    expect(variantsDraftError({ ...draft, rows: [draft.rows[0], { ...row, priceDelta: "2.5" }] }, 5000)).toEqual({ index: 1, key: "variants.error.delta" });
    expect(variantsDraftError({ ...draft, rows: [draft.rows[0], { ...row, priceDelta: "-5000" }] }, 5000)).toEqual({ index: 1, key: "variants.error.price" });
    expect(variantsDraftError({ ...draft, rows: [{ ...draft.rows[0], sku: "A1" }, { ...row, sku: "a1" }] }, 5000)).toEqual({ index: 1, key: "variants.error.sku" });
  });
});

describe("variantsPayload", () => {
  it("sends options by name, whole numbers, and keeps ids and hidden flags", () => {
    const body = variantsPayload({ names: [" Colour ", "Size"], rows: [{ ...draft.rows[0], id: "v1", values: [" Red ", "M"], isActive: false }, draft.rows[1]] });
    expect(body[0]).toEqual({ id: "v1", options: { Colour: "Red", Size: "M" }, price_delta_xaf: 0, quantity: 4, sku: "", photo_url: "", is_active: false });
    expect(body[1]).toMatchObject({ options: { Colour: "Red", Size: "L" }, price_delta_xaf: -500, quantity: 2, sku: "tee-2" });
    expect(body[1]).not.toHaveProperty("id");
  });
});

describe("totalStock", () => {
  it("adds up the stock of visible versions", () => {
    expect(totalStock(draft)).toBe(6);
    expect(totalStock({ ...draft, rows: [draft.rows[0], { ...draft.rows[1], isActive: false }] })).toBe(4);
  });
});

describe("groupVariantErrors", () => {
  it("splits row problems from general ones", () => {
    expect(groupVariantErrors([
      { index: 1, field: "sku", message: "Bad SKU." },
      { index: 1, field: "quantity", message: "Bad stock." },
      { field: "variants", message: "Too many." },
    ])).toEqual({ general: ["Too many."], rows: { 1: ["Bad SKU.", "Bad stock."] } });
  });
});
