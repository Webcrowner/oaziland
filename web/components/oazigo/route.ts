/**
 * Decodes a Google encoded polyline (the road route from the server's quote) into [latitude, longitude] pairs.
 * Format: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < encoded.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/** "25 min" or "1 h 05 min". */
export function formatDuration(minutes: number, labels: { min: string; h: string }): string {
  if (minutes < 60) return `${minutes} ${labels.min}`;
  return `${Math.floor(minutes / 60)} ${labels.h} ${String(minutes % 60).padStart(2, "0")} ${labels.min}`;
}
