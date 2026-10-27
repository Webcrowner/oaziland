import { RIDE_CATEGORIES } from "./styles";

type Category = (typeof RIDE_CATEGORIES)[number];

// Mirrors RIDE_CATEGORY_RATES in backend/marketplace/services.py, for a
// live preview only. The server always recalculates the real fare.
const RATES: Record<Category, { base: number; perKm: number }> = {
  MOTO: { base: 300, perKm: 100 },
  STANDARD: { base: 500, perKm: 150 },
  COMFORT: { base: 800, perKm: 220 },
  VAN: { base: 1500, perKm: 300 },
  TRUCK: { base: 2500, perKm: 450 },
};

// Straight-line distance understates the real road distance.
const ROAD_FACTOR = 1.3;

export function estimateFareXaf(category: Category, distanceKm: number): number {
  const { base, perKm } = RATES[category];
  return Math.round(base + distanceKm * perKm);
}

export function roadDistanceKm(
  a: { latitude: number | null; longitude: number | null },
  b: { latitude: number | null; longitude: number | null },
): number | null {
  if (a.latitude === null || a.longitude === null || b.latitude === null || b.longitude === null) return null;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  const straight = 2 * 6371 * Math.asin(Math.sqrt(h));
  return Math.max(0.1, Math.round(straight * ROAD_FACTOR * 10) / 10);
}
