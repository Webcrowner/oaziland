import * as Location from "expo-location";

export interface Coords {
  latitude: number;
  longitude: number;
}

/**
 * The phone's current position, or null if permission is refused or no fix arrives within the time limit.
 * Falls back to a recent last-known position so a slow GPS never blocks something urgent like an SOS.
 */
export async function getCurrentCoords(timeoutMs = 5000): Promise<Coords | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;

    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
    const fresh = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), timeout]);
    const position = fresh ?? (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 }));
    return position ? { latitude: position.coords.latitude, longitude: position.coords.longitude } : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
