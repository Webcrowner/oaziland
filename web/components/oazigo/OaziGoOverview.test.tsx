import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import OaziGoShell from "./OaziGoShell";
import OaziGoPage from "@/app/[locale]/oazigo/page";
import { makeRide, renderWithIntl } from "./test-utils";

const mocks = vi.hoisted(() => ({ pathname: vi.fn(), state: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
  usePathname: mocks.pathname,
}));
vi.mock("./OaziGoProvider", () => ({
  OaziGoProvider: ({ children }: { children: ReactNode }) => children,
  useOaziGo: mocks.state,
}));
vi.mock("./DriverLocationSharer", () => ({ default: () => null }));
vi.mock("./RideOfferBanner", () => ({ default: () => null }));

describe("OaziGo overview", () => {
  beforeEach(() => {
    mocks.pathname.mockReturnValue("/oazigo");
    mocks.state.mockReturnValue({
      status: "signedOut",
      myRides: [],
      driverProfile: null,
      vehicles: [],
      myUserId: null,
    });
  });

  it("shows a sign-in preview and public car listings without exposing protected content", () => {
    renderWithIntl(<OaziGoShell><OaziGoPage /></OaziGoShell>);

    expect(screen.getByRole("heading", { name: "OaziGo" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Rent or buy a car" })).toHaveAttribute("href", "/oazigo/cars");
    expect(screen.queryByRole("link", { name: "Request a trip" })).not.toBeInTheDocument();
  });

  it("keeps other ride pages behind sign-in", () => {
    mocks.pathname.mockReturnValue("/oazigo/request");
    renderWithIntl(<OaziGoShell><p>Protected page</p></OaziGoShell>);

    expect(screen.queryByText("Protected page")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("tells the user when live updates are paused and lets them retry", () => {
    const reload = vi.fn();
    mocks.state.mockReturnValue({ status: "ready", myRides: [], driverProfile: null, vehicles: [], myUserId: "rider-1", stale: true, reload });
    renderWithIntl(<OaziGoShell><p>Page</p></OaziGoShell>);

    expect(screen.getByText(/Live updates are paused/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalled();
  });

  it("warns that driver details failed to load rather than looking like a non-driver", () => {
    mocks.state.mockReturnValue({ status: "ready", myRides: [], driverProfile: null, vehicles: [], myUserId: "rider-1", driverDataFailed: true, reload: vi.fn() });
    renderWithIntl(<OaziGoShell><p>Page</p></OaziGoShell>);

    expect(screen.getByText(/couldn't load your driver details/)).toBeInTheDocument();
  });

  it("preserves active trip details and verified driver navigation", () => {
    mocks.state.mockReturnValue({
      status: "ready",
      myRides: [makeRide({ status: "ACCEPTED" })],
      driverProfile: { is_verified: true, is_online: false },
      vehicles: [],
      myUserId: "rider-1",
    });
    renderWithIntl(<OaziGoShell><OaziGoPage /></OaziGoShell>);

    expect(screen.getByText("Bastos")).toBeInTheDocument();
    expect(screen.getByText("Mvan")).toBeInTheDocument();
    expect(screen.getByText("Your driver: Paul")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Open requests/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /Request a trip/ }).length).toBeGreaterThan(0);
  });
});
