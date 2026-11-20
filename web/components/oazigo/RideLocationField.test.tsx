import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import RideLocationField, { type Coords } from "./RideLocationField";
import { renderWithIntl } from "./test-utils";

function Harness() {
  const [value, setValue] = useState("");
  const [coords, setCoords] = useState<Coords>({ latitude: null, longitude: null });
  return (
    <RideLocationField
      id="pickup" label="Pickup" placeholder="Pickup place" value={value} onValueChange={setValue}
      coords={coords} onCoordsChange={setCoords} allowCurrentLocation
    />
  );
}

function stubGps() {
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (ok: (pos: unknown) => void) => ok({ coords: { latitude: 3.848, longitude: 11.5021 } }),
    },
  });
}

describe("RideLocationField current location", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the place name and the coordinates once the position is found", async () => {
    stubGps();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ display_name: "Bastos, Yaoundé, Centre, Cameroun" }))));
    renderWithIntl(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: /Use my location/ }));

    await waitFor(() => expect(screen.getByLabelText("Pickup")).toHaveValue("Bastos, Yaoundé, Centre"));
    expect(screen.getByText("3.84800, 11.50210")).toBeInTheDocument();
  });

  it("falls back to the coordinates when the place name can't be found", async () => {
    stubGps();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    renderWithIntl(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: /Use my location/ }));

    await waitFor(() => expect(screen.getByLabelText("Pickup")).toHaveValue("3.84800, 11.50210"));
  });

  it("drops the saved point as soon as the address text is edited, so text and coordinates cannot disagree", async () => {
    stubGps();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ display_name: "Bastos, Yaoundé, Centre, Cameroun" }))));
    renderWithIntl(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Use my location/ }));
    await waitFor(() => expect(screen.getByText("3.84800, 11.50210")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Pickup"), { target: { value: "Mvan, Yaoundé" } });

    expect(screen.queryByText("3.84800, 11.50210")).not.toBeInTheDocument();
    expect(screen.queryByText(/Location set/)).not.toBeInTheDocument();
  });
});
