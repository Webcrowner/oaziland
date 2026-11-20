"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiStatusError, listMyRides, getMyDriverProfile, listMyVehicles, getMyProfile,
  type RideBookingItem, type DriverProfileItem, type VehicleItem,
} from "@/lib/api";
import { ACTIVE_RIDE_STATUSES } from "./styles";

type OaziGoStatus = "loading" | "signedOut" | "ready";

/** How often trips are refreshed in the background while the rider or driver has a trip in progress. */
const POLL_MS = 8000;

interface OaziGoState {
  status: OaziGoStatus;
  rides: RideBookingItem[];
  /** Rides where the signed-in user is the rider or the driver. */
  myRides: RideBookingItem[];
  driverProfile: DriverProfileItem | null;
  vehicles: VehicleItem[];
  myUserId: string | null;
  canDrive: boolean;
  /** True when the trips list could not be fetched, so pages can tell "failed" apart from "no trips". */
  loadFailed: boolean;
  /** True when the driver profile or vehicles could not be fetched, so driver pages may be incomplete. */
  driverDataFailed: boolean;
  /** True when a background refresh failed, so what is shown may be out of date. */
  stale: boolean;
  reload: () => void;
}

const OaziGoContext = createContext<OaziGoState | null>(null);

const isUnauthorized = (err: unknown) => (err as { status?: number } | null)?.status === 401;

/** Loads rides, driver profile and vehicles once and shares them across every OaziGo page. */
export function OaziGoProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<OaziGoStatus>("loading");
  const [rides, setRides] = useState<RideBookingItem[]>([]);
  const [driverProfile, setDriverProfile] = useState<DriverProfileItem | null>(null);
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [driverDataFailed, setDriverDataFailed] = useState(false);
  const [stale, setStale] = useState(false);

  // Only the newest response of each kind may update the page, so a slow old request never overwrites newer data.
  const loadId = useRef(0);
  const ridesId = useRef(0);
  const loadedOnce = useRef(false);

  const load = useCallback((silent: boolean) => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    const id = ++loadId.current;
    ridesId.current++;
    if (!silent) {
      setStatus("loading");
      setLoadFailed(false);
    }
    Promise.allSettled([listMyRides(token), getMyDriverProfile(token), listMyVehicles(token), getMyProfile(token)])
      .then(([ridesResult, driverResult, vehiclesResult, profileResult]) => {
        if (id !== loadId.current) return;
        // The shared fetch already tried to refresh the token; a 401 here means the session is over,
        // which is a sign-in problem rather than a connection one.
        if ([ridesResult, profileResult].some((r) => r.status === "rejected" && isUnauthorized(r.reason))) {
          setStatus("signedOut");
          return;
        }
        // Trips and the user's identity are what every page needs; without them the lists would be wrong.
        if (ridesResult.status === "rejected" || profileResult.status === "rejected") {
          if (silent && loadedOnce.current) setStale(true);
          else {
            setLoadFailed(true);
            setStatus("ready");
          }
          return;
        }
        loadedOnce.current = true;
        setRides(ridesResult.value.results);
        setMyUserId(profileResult.value.id);
        // A failed driver lookup must not look like "you are not a driver", so the previous values are kept.
        if (driverResult.status === "fulfilled") setDriverProfile(driverResult.value);
        if (vehiclesResult.status === "fulfilled") setVehicles(vehiclesResult.value.results);
        setDriverDataFailed(driverResult.status === "rejected" || vehiclesResult.status === "rejected");
        setLoadFailed(false);
        setStale(false);
        setStatus("ready");
      });
  }, []);

  // Refreshes only the trips, quietly, so status changes (a driver accepting, a payment arriving) show up on their own.
  const refreshRides = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    const id = ++ridesId.current;
    listMyRides(token)
      .then((data) => {
        if (id !== ridesId.current) return;
        setRides(data.results);
        setStale(false);
      })
      .catch((err) => {
        if (id !== ridesId.current) return;
        if (err instanceof ApiStatusError && err.status === 401) setStatus("signedOut");
        else setStale(true);
      });
  }, []);

  const reload = useCallback(() => load(loadedOnce.current), [load]);

  useEffect(() => {
    Promise.resolve().then(() => load(false));
  }, [load]);

  const myRides = useMemo(
    () => (myUserId ? rides.filter((r) => r.rider === myUserId || r.driver === myUserId) : rides),
    [rides, myUserId],
  );
  const hasActiveRide = myRides.some((r) => ACTIVE_RIDE_STATUSES.includes(r.status));

  useEffect(() => {
    if (status !== "ready" || !hasActiveRide) return;
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") refreshRides();
    };
    const timer = window.setInterval(refreshIfVisible, POLL_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("online", refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("online", refreshIfVisible);
    };
  }, [status, hasActiveRide, refreshRides]);

  const value = useMemo<OaziGoState>(
    () => ({
      status, rides, driverProfile, vehicles, myUserId, myRides,
      canDrive: Boolean(driverProfile?.is_verified && vehicles.length > 0),
      loadFailed, driverDataFailed, stale,
      reload,
    }),
    [status, rides, driverProfile, vehicles, myUserId, myRides, loadFailed, driverDataFailed, stale, reload],
  );

  return <OaziGoContext.Provider value={value}>{children}</OaziGoContext.Provider>;
}

export function useOaziGo(): OaziGoState {
  const ctx = useContext(OaziGoContext);
  if (!ctx) throw new Error("useOaziGo must be used inside OaziGoProvider");
  return ctx;
}
