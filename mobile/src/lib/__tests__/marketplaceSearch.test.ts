import { searchableQuery, searchMarketplace, type ListCategory } from "../marketplaceSearch";

const listing = (id: string) => ({ id, title: `Listing ${id}`, price_xaf: "1000", price_basis: "SALE", quarter_name: null });

describe("searchableQuery", () => {
  it("needs at least two characters after trimming", () => {
    expect(searchableQuery(" a ")).toBe("");
    expect(searchableQuery("")).toBe("");
    expect(searchableQuery("  ab ")).toBe("ab");
  });
});

describe("searchMarketplace", () => {
  it("asks every category for the query, newest first, and tags each result with its category", async () => {
    const calls: [string, Record<string, string>][] = [];
    const list: ListCategory = async (category, filters) => {
      calls.push([category, filters]);
      return { count: 1, results: [listing(category)] };
    };
    const outcome = await searchMarketplace("depot", list);
    expect(calls.map(([category]) => category)).toEqual(["warehouses", "stores", "businesses", "cars"]);
    expect(calls.every(([, filters]) => filters.q === "depot" && filters.ordering === "newest")).toBe(true);
    expect(outcome).toMatchObject({ partial: false, failed: false });
    expect(outcome.results.map((r) => [r.category, r.id])).toEqual([
      ["warehouses", "warehouses"], ["stores", "stores"], ["businesses", "businesses"], ["cars", "cars"],
    ]);
  });

  it("keeps the results of the categories that answered when one fails", async () => {
    const list: ListCategory = async (category) => {
      if (category === "stores") throw new Error("down");
      return { count: 1, results: [listing(category)] };
    };
    const outcome = await searchMarketplace("shop", list);
    expect(outcome.partial).toBe(true);
    expect(outcome.failed).toBe(false);
    expect(outcome.results.map((r) => r.category)).toEqual(["warehouses", "businesses", "cars"]);
  });

  it("reports a failure only when every category fails", async () => {
    const list: ListCategory = async () => { throw new Error("down"); };
    expect(await searchMarketplace("shop", list)).toEqual({ results: [], partial: false, failed: true });
  });
});
