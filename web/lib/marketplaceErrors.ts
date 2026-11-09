/** Pulls a readable message out of the JSON error text `createMarketplaceListing` throws (the API's `detail` or first field error). */
export function listingErrorMessage(error: unknown, fallback: string): string {
  try {
    const data = JSON.parse((error as Error).message);
    if (typeof data.detail === "string") return data.detail;
    const first = Object.values(data).flat()[0];
    if (typeof first === "string") return first;
  } catch {
    // Not a JSON API error — fall through to the generic message.
  }
  return fallback;
}
