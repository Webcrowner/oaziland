import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import DriverEarnings from "./DriverEarnings";
import { makeRide, renderWithIntl } from "./test-utils";

describe("DriverEarnings", () => {
  it("counts only trips the user drove, not trips they booked as a rider", () => {
    const rides = [
      makeRide({ id: "a", driver: "me", fare_estimate_xaf: "3500" }),
      makeRide({ id: "b", driver: "me", fare_estimate_xaf: "4200" }),
      makeRide({ id: "c", driver: "me", status: "ACCEPTED", fare_estimate_xaf: "2800" }),
      makeRide({ id: "d", rider: "me", driver: "someone-else", fare_estimate_xaf: "9999" }),
    ];
    renderWithIntl(<DriverEarnings rides={rides} driverId="me" />);

    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1 in progress")).toBeInTheDocument();
    // 3,500 + 4,200; the active trip and the rider booking are not earnings.
    expect(screen.getByText((_, el) => el?.tagName === "P" && /^7,700\s*XAF$/.test(el.textContent ?? ""))).toBeInTheDocument();
    expect(screen.queryByText(/9,999/)).not.toBeInTheDocument();
  });

  it("shows nothing as earnings when the user is unknown", () => {
    renderWithIntl(<DriverEarnings rides={[makeRide({ driver: "me" })]} driverId={null} />);
    expect(screen.getByText(/No driving trips yet/)).toBeInTheDocument();
  });
});
