import { filtersToQuery, filtersActive, EMPTY_MARKETPLACE_FILTERS } from "../marketplaceFilters";

describe("marketplace filters", () => {
  it("always sends the sort order and drops blank filters", () => {
    expect(filtersToQuery(EMPTY_MARKETPLACE_FILTERS)).toEqual({ ordering: "newest" });
  });

  it("maps every filled filter to the API's parameter names", () => {
    expect(filtersToQuery({ q: " depot ", ordering: "price_asc", priceBasis: "SALE", minPrice: "100", maxPrice: " 900 " })).toEqual({
      ordering: "price_asc", q: "depot", price_basis: "SALE", min_price: "100", max_price: "900",
    });
  });

  it("treats the default sort alone as not filtering", () => {
    expect(filtersActive({ ...EMPTY_MARKETPLACE_FILTERS, ordering: "price_desc" })).toBe(false);
    expect(filtersActive({ ...EMPTY_MARKETPLACE_FILTERS, q: "shed" })).toBe(true);
  });
});
