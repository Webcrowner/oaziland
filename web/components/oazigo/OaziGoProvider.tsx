"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  listMyRides, getMyDriverProfile, listMyVehicles, getMyProfile,
  type RideBookingItem, type DriverProfileItem, type VehicleItem,
} from "@/lib/api";

type OaziGoStatus = "loading" | "signedOut" | "ready";

interface OaziGoState {
  status: OaziGoStatus;
  rides: RideBookingItem[];
  /** Rides where the signed-in user is the rider or the driver. */
  myRides: RideBookingItem[];
  driverProfile: DriverProfileItem | null;
  vehicles: VehicleItem[];
  myUserId: string | null;
  canDrive: boolean;
  reload: () => void;
}

const OaziGoContext = createContext<OaziGoState | null>(null);

/** Loads rides, driver profile and vehicles once and shares them across every OaziGo page. */
export function OaziGoProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<OaziGoStatus>("loading");
  const [rides, setRides] = useState<RideBookingItem[]>([]);
  const [driverProfile, setDriverProfile] = useState<DriverProfileItem | null>(null);
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    Promise.all([
      listMyRides(token),
      getMyDriverProfile(token).catch(() => null),
      listMyVehicles(token).catch(() => ({ results: [] })),
      getMyProfile(token).catch(() => null),
    ])
      .then(([ridesData, driverData, vehiclesData, profileData]) => {
        setRides(ridesData.results);
        setDriverProfile(driverData);
        setVehicles(vehiclesData.results);
        if (profileData) setMyUserId(profileData.id);
      })
      .catch(() => {})
      .finally(() => setStatus("ready"));
  }, []);

  useEffect(() => {
    Promise.resolve().then(load);
  }, [load]);

  const value = useMemo<OaziGoState>(
    () => ({
      status, rides, driverProfile, vehicles, myUserId,
      myRides: myUserId ? rides.filter((r) => r.rider === myUserId || r.driver === myUserId) : rides,
      canDrive: Boolean(driverProfile?.is_verified && vehicles.length > 0),
      reload: load,
    }),
    [status, rides, driverProfile, vehicles, myUserId, load],
  );

  return <OaziGoContext.Provider value={value}>{children}</OaziGoContext.Provider>;
}

export function useOaziGo(): OaziGoState {
  const ctx = useContext(OaziGoContext);
  if (!ctx) throw new Error("useOaziGo must be used inside OaziGoProvider");
  return ctx;
}
