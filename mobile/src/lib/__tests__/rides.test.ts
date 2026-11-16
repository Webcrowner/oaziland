import { canReportRideIssue, cancelRide, driverEarnings, releaseRide, reportRideIssue, searchPlaces, vehiclesForRide, type RideBookingItem } from "../api";

jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn().mockResolvedValue("token") }));

function ride(overrides: Partial<RideBookingItem>): RideBookingItem {
  return {
    id: "r", rider: "rider", rider_name: "", driver: null, driver_name: null, vehicle: null, vehicle_details: null,
    pickup_description: "", dropoff_description: "", fare_estimate_xaf: "0", status: "COMPLETED",
    ride_category: "STANDARD", transport_type: "PASSENGER", has_luggage: false, cargo_description: "",
    ...overrides,
  };
}

describe("driverEarnings", () => {
  it("counts only trips the user drove, not trips they booked as a rider", () => {
    const rides = [
      ride({ id: "a", driver: "me", fare_estimate_xaf: "3500" }),
      ride({ id: "b", driver: "me", fare_estimate_xaf: "4200" }),
      ride({ id: "c", driver: "me", status: "IN_PROGRESS", fare_estimate_xaf: "2800" }),
      ride({ id: "d", rider: "me", driver: "other", fare_estimate_xaf: "9999" }),
    ];
    expect(driverEarnings(rides, "me")).toEqual({ completedTrips: 2, activeTrips: 1, grossXaf: 7700 });
    expect(driverEarnings(rides, null)).toEqual({ completedTrips: 0, activeTrips: 0, grossXaf: 0 });
  });
});

describe("cancel and release reasons", () => {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  beforeEach(() => {
    fetchMock.mockClear();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("sends the chosen reason as JSON", async () => {
    await cancelRide("r1", { reason: "WAITED_TOO_LONG", note: "20 min" });
    await releaseRide("r2", { reason: "VEHICLE_PROBLEM" });
    const [cancelUrl, cancelInit] = fetchMock.mock.calls[0];
    expect(cancelUrl).toMatch(/\/api\/rides\/r1\/cancel\/$/);
    expect(JSON.parse(cancelInit.body)).toEqual({ reason: "WAITED_TOO_LONG", note: "20 min" });
    expect(cancelInit.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ reason: "VEHICLE_PROBLEM" });
  });

  it("still works with no reason, as older calls did", async () => {
    await cancelRide("r1");
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });
});

describe("trip problem reports", () => {
  const now = new Date("2026-11-13T09:00:00Z").getTime();

  it("is only offered to the rider or driver, once a driver took the trip, within 14 days", () => {
    const taken = ride({ status: "COMPLETED", rider: "me", driver: "d", requested_at: "2026-11-10T09:00:00Z" });
    expect(canReportRideIssue(taken, "me", now)).toBe(true);
    expect(canReportRideIssue(taken, "d", now)).toBe(true);
    expect(canReportRideIssue(taken, "stranger", now)).toBe(false);
    expect(canReportRideIssue(taken, null, now)).toBe(false);
    expect(canReportRideIssue({ ...taken, status: "REQUESTED" }, "me", now)).toBe(false);
    expect(canReportRideIssue({ ...taken, requested_at: "2026-10-20T09:00:00Z" }, "me", now)).toBe(false);
  });

  it("sends the report, and surfaces the server's reason when refused", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 1 }) })
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ detail: "You already reported a problem with this ride." }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await reportRideIssue("r1", { category: "FARE", description: "Asked for extra cash." });
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/rides\/r1\/report-issue\/$/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ category: "FARE", description: "Asked for extra cash." });
    await expect(reportRideIssue("r1", { category: "FARE", description: "Again and again." })).rejects.toThrow("You already reported");
  });
});

describe("vehiclesForRide", () => {
  const fleet = [{ id: 1, vehicle_category: "MOTO" }, { id: 2, vehicle_category: "STANDARD" }, { id: 3, vehicle_category: "VAN" }, { id: 4, vehicle_category: "TRUCK" }];

  it("matches the exact category for passengers", () => {
    expect(vehiclesForRide(fleet, { transport_type: "PASSENGER", ride_category: "STANDARD" }).map((v) => v.id)).toEqual([2]);
    expect(vehiclesForRide(fleet, { transport_type: "PASSENGER", ride_category: "COMFORT" })).toEqual([]);
  });

  it("lets any van or truck carry cargo, whatever category was asked for", () => {
    expect(vehiclesForRide(fleet, { transport_type: "CARGO", ride_category: "STANDARD" }).map((v) => v.id)).toEqual([3, 4]);
  });
});

describe("searchPlaces", () => {
  it("searches Cameroon only and returns short labels with rounded points", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ place_id: 7, display_name: "Bastos, Yaoundé I, Mfoundi, Centre, Cameroun", lat: "3.89012345", lon: "11.51098765" }]),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(await searchPlaces("Bastos", "fr")).toEqual([{ id: "7", label: "Bastos, Yaoundé I, Mfoundi", latitude: 3.890123, longitude: 11.510988 }]);
    expect(fetchMock.mock.calls[0][0]).toContain("countrycodes=cm");
    expect(fetchMock.mock.calls[0][1].headers["Accept-Language"]).toBe("fr");
  });
});
