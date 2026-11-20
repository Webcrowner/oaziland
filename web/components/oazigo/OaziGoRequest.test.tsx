import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import OaziGoRequestPage from "@/app/[locale]/oazigo/request/page";
import { makeRide, renderWithIntl } from "./test-utils";

const mocks = vi.hoisted(() => ({ quote: vi.fn(), state: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/oazigo/request",
}));
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), quoteRide: mocks.quote }));
vi.mock("./OaziGoProvider", () => ({ useOaziGo: mocks.state }));
vi.mock("./RouteMap", () => ({ default: () => null }));
vi.mock("./RideLocationField", () => ({
  default: ({ id, value, onValueChange, onCoordsChange }: { id: string; value: string; onValueChange: (v: string) => void; onCoordsChange: (c: { latitude: number; longitude: number }) => void }) => (
    <button type="button" data-testid={id} onClick={() => { onValueChange(`Place ${id}`); onCoordsChange({ latitude: id.includes("pickup") ? 3.88 : 3.82, longitude: 11.52 }); }}>
      {value || `choose ${id}`}
    </button>
  ),
}));

describe("OaziGo booking page", () => {
  beforeEach(() => {
    localStorage.setItem("access_token", "token");
    mocks.state.mockReturnValue({ reload: vi.fn(), myRides: [], myUserId: "rider-1" });
    mocks.quote.mockResolvedValue({ distance_km: "12.5", duration_minutes: 20, polyline: "", source: "google", fares: { MOTO: "1500", STANDARD: "2375", COMFORT: "3000", VAN: "4000", TRUCK: "5000" } });
  });
  afterEach(() => vi.clearAllMocks());

  it("starts at the route step, with the request button off until a price exists", () => {
    renderWithIntl(<OaziGoRequestPage />);

    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Route");
    expect(screen.getByText(/Prices appear once you have chosen your route/)).toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: "Request OaziGo" })) expect(button).toBeDisabled();
  });

  it("warns up front and turns the request button off while a trip is already open", async () => {
    mocks.state.mockReturnValue({ reload: vi.fn(), myRides: [makeRide({ status: "ACCEPTED", rider: "rider-1" })], myUserId: "rider-1" });
    renderWithIntl(<OaziGoRequestPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("You already have a trip in progress");
    expect(screen.getByRole("link", { name: "View my trip" })).toHaveAttribute("href", "/oazigo/trips");
    fireEvent.click(screen.getByTestId("oazigo-pickup"));
    fireEvent.click(screen.getByTestId("oazigo-dropoff"));
    await waitFor(() => expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Confirm"));
    for (const button of screen.getAllByRole("button", { name: /Request OaziGo/ })) expect(button).toBeDisabled();
  });

  it("moves on to confirming once the route is chosen, and puts the fare on the request button", async () => {
    renderWithIntl(<OaziGoRequestPage />);

    fireEvent.click(screen.getByTestId("oazigo-pickup"));
    fireEvent.click(screen.getByTestId("oazigo-dropoff"));

    await waitFor(() => expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Confirm"));
    expect(screen.getByText("Place oazigo-pickup", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText(/Nothing is charged now/)).toBeInTheDocument();
    const [button] = screen.getAllByRole("button", { name: /Request OaziGo · 2,375 XAF/ });
    expect(button).toBeEnabled();
  });
});
