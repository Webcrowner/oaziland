import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/en.json";
import type { RideBookingItem } from "@/lib/api";

/** Renders a component with the real English messages, as the app does. */
export function renderWithIntl(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Africa/Douala">
      {ui}
    </NextIntlClientProvider>,
  );
}

export function makeRide(overrides: Partial<RideBookingItem> = {}): RideBookingItem {
  return {
    id: "ride-1",
    rider: "rider-1",
    rider_name: "Awa",
    driver: "driver-1",
    driver_name: "Paul",
    vehicle: 1,
    vehicle_details: null,
    pickup_description: "Bastos",
    dropoff_description: "Mvan",
    fare_estimate_xaf: "2000",
    distance_km: "10",
    status: "COMPLETED",
    ride_category: "STANDARD",
    transport_type: "PASSENGER",
    has_luggage: false,
    luggage_count: null,
    luggage_size: "",
    luggage_photo_urls: [],
    cargo_description: "",
    requested_at: "2026-11-10T09:00:00Z",
    completed_at: null,
    ...overrides,
  };
}
