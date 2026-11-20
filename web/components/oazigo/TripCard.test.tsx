import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import TripCard from "./TripCard";
import { makeRide, renderWithIntl } from "./test-utils";

const mocks = vi.hoisted(() => ({ state: vi.fn() }));
vi.mock("./OaziGoProvider", () => ({ useOaziGo: mocks.state }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children }: { children: ReactNode }) => children, usePathname: () => "/oazigo/trips" }));
vi.mock("@/components/RateAndReport", () => ({ default: () => null }));
vi.mock("./DriverTrackingMap", () => ({ default: () => null }));
vi.mock("@/components/RideChat", () => ({ default: () => null }));
vi.mock("./RideIssueForm", () => ({ default: () => null }));

function viewAs(userId: string) {
  mocks.state.mockReturnValue({ myUserId: userId, reload: vi.fn() });
}

describe("TripCard fare payment", () => {
  afterEach(() => vi.clearAllMocks());

  it("offers payment only to the rider, since the server refuses anyone else", () => {
    viewAs("driver-1");
    renderWithIntl(<TripCard ride={makeRide({ status: "IN_PROGRESS" })} />);

    expect(screen.queryByRole("button", { name: /Complete & Pay/ })).not.toBeInTheDocument();
  });

  it("keeps showing a payment that is waiting for approval after a reload, instead of offering to pay again", () => {
    viewAs("rider-1");
    renderWithIntl(<TripCard ride={makeRide({ status: "IN_PROGRESS", payment_pending: true })} />);

    expect(screen.getByText(/Approve the payment on your phone/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Complete & Pay/ })).not.toBeInTheDocument();
  });

  it("tells the driver the rider is still approving the fare", () => {
    viewAs("driver-1");
    renderWithIntl(<TripCard ride={makeRide({ status: "IN_PROGRESS", payment_pending: true })} />);

    expect(screen.getByText(/rider is approving the fare/)).toBeInTheDocument();
  });

  it("shows a live banner, the route and the plate to check while the driver is on the way", () => {
    viewAs("rider-1");
    renderWithIntl(<TripCard ride={makeRide({
      status: "ACCEPTED",
      vehicle_details: { make: "Toyota", model: "Corolla", plate_number: "LT-001-AB" } as never,
    })} />);

    expect(screen.getByRole("status")).toHaveTextContent("Your driver is on the way");
    expect(screen.getByText("Bastos")).toBeInTheDocument();
    expect(screen.getByText("Mvan")).toBeInTheDocument();
    expect(screen.getByLabelText("Plate: LT-001-AB")).toBeInTheDocument();
    expect(screen.getByText(/Check the plate/)).toBeInTheDocument();
  });

  it("tells the driver where to go instead of showing the rider's wording", () => {
    viewAs("driver-1");
    renderWithIntl(<TripCard ride={makeRide({ status: "ACCEPTED" })} />);

    expect(screen.getByRole("status")).toHaveTextContent("Head to the pickup point");
  });

  it("does not show a live banner once the trip is over", () => {
    viewAs("rider-1");
    renderWithIntl(<TripCard ride={makeRide({ status: "COMPLETED" })} />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("explains in words why an automatically closed trip ended, not as something the rider did", () => {
    viewAs("rider-1");
    renderWithIntl(<TripCard ride={makeRide({ status: "CANCELLED", cancellation_reason: "TRIP_ABANDONED" })} />);

    expect(screen.getByText(/never completed or paid/)).toBeInTheDocument();
    expect(screen.queryByText(/You cancelled/)).not.toBeInTheDocument();
  });

  it("lets the rider start paying when nothing is pending", () => {
    viewAs("rider-1");
    renderWithIntl(<TripCard ride={makeRide({ status: "IN_PROGRESS" })} />);

    expect(screen.getByRole("button", { name: /Complete & Pay/ })).toBeInTheDocument();
  });
});
