import type { Quarter } from "@/lib/api";

/**
 * The `<option>` list for every neighbourhood dropdown — grouped by region and
 * labelled "Name (City)" so same-named areas in different towns stay distinct.
 * Free-text areas are never accepted; users can only pick from the seeded list.
 */
export default function QuarterOptions({ quarters }: { quarters: Quarter[] }) {
  const byRegion = quarters.reduce<Record<string, Quarter[]>>((groups, q) => {
    (groups[q.region_name || "Other"] ??= []).push(q);
    return groups;
  }, {});

  return (
    <>
      {Object.entries(byRegion)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([region, regionQuarters]) => (
          <optgroup key={region} label={region}>
            {regionQuarters.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name} ({q.village_name})
              </option>
            ))}
          </optgroup>
        ))}
    </>
  );
}
