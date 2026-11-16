import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import RideOfferBanner from "./RideOfferBanner";
import { makeRide, renderWithIntl } from "./test-utils";

const push = vi.fn();
const reload = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./OaziGoProvider", () => ({
  useOaziGo: () => ({
    driverProfile: { id: 1, user_name: "Paul", license_number: "X", is_verified: true, is_online: true, vehicles: [] },
    vehicles: [
      { id: 7, vehicle_category: "MOTO", make: "Honda", model: "CG", plate_number: "M-1" },
      { id: 9, vehicle_category: "STANDARD", make: "Toyota", model: "Yaris", plate_number: "LT-1" },
    ],
    reload,
  }),
}));

function offerResponse() {
  return new Response(JSON.stringify({
    offer: { ride: { ...makeRide({ id: "r1", status: "REQUESTED", driver: null }), pickup_distance_km: "0.6" }, expires_at: "", seconds_left: 18 },
    offer_seconds: 20,
  }));
}

describe("RideOfferBanner", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    push.mockClear();
  });

  it("shows the offer and accepts it with the driver's vehicle that fits the ride", async () => {
    localStorage.setItem("access_token", "token");
    const fetchMock = vi.fn().mockResolvedValueOnce(offerResponse()).mockResolvedValue(new Response(JSON.stringify({ id: "r1" })));
    vi.stubGlobal("fetch", fetchMock);
    renderWithIntl(<RideOfferBanner />);

    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Bastos");
    expect(screen.getByText("0.6 km away")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/oazigo/trips"));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toMatch(/\/api\/rides\/r1\/accept\/$/);
    // The Standard car, not the moto: only it can serve a Standard ride.
    expect(JSON.parse(init.body)).toEqual({ vehicle_id: 9 });
  });

  it("declines the offer", async () => {
    localStorage.setItem("access_token", "token");
    const fetchMock = vi.fn().mockResolvedValueOnce(offerResponse()).mockResolvedValue(new Response(JSON.stringify({ detail: "Offer declined." })));
    vi.stubGlobal("fetch", fetchMock);
    renderWithIntl(<RideOfferBanner />);

    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/api\/rides\/r1\/decline\/$/);
    expect(push).not.toHaveBeenCalled();
  });
});
