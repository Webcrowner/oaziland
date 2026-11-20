import { afterEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { OaziGoProvider, useOaziGo } from "./OaziGoProvider";
import { makeRide, renderWithIntl } from "./test-utils";

function Probe() {
  const { status, loadFailed, driverDataFailed, stale, myRides } = useOaziGo();
  return <p>{[status, loadFailed ? "failed" : "ok", driverDataFailed ? "driver-failed" : "driver-ok", stale ? "stale" : "fresh", myRides[0]?.status ?? "none"].join(":")}</p>;
}

type Reply = { status: number; body?: unknown } | (() => { status: number; body?: unknown });

function stubFetch(replies: { rides: Reply; driver?: Reply; vehicles?: Reply; me?: Reply }) {
  const fallback = { status: 404 };
  const pick = (url: string): Reply => {
    if (url.includes("/api/rides/")) return replies.rides;
    if (url.includes("/api/my-driver-profile/")) return replies.driver ?? fallback;
    if (url.includes("/api/my-vehicles/")) return replies.vehicles ?? { status: 200, body: { count: 0, results: [] } };
    if (url.includes("/api/auth/me/")) return replies.me ?? { status: 200, body: { id: "me" } };
    return fallback;
  };
  const fetchMock = vi.fn((url: string) => {
    const reply = pick(String(url));
    const { status, body } = typeof reply === "function" ? reply() : reply;
    return Promise.resolve(new Response(JSON.stringify(body ?? {}), { status }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ridesBody = (...statuses: string[]) => ({ count: statuses.length, results: statuses.map((status, i) => makeRide({ id: `r${i}`, status: status as never, rider: "me" })) });

describe("OaziGoProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("treats an expired session (401 that cannot be refreshed) as signed out, not as a connection error", async () => {
    localStorage.setItem("access_token", "expired");
    stubFetch({ rides: { status: 401 } });
    renderWithIntl(<OaziGoProvider><Probe /></OaziGoProvider>);

    await waitFor(() => expect(screen.getByText(/^signedOut:/)).toBeInTheDocument());
  });

  it("reports a failed trips load for server errors so the page can offer a retry", async () => {
    localStorage.setItem("access_token", "token");
    stubFetch({ rides: { status: 503 } });
    renderWithIntl(<OaziGoProvider><Probe /></OaziGoProvider>);

    await waitFor(() => expect(screen.getByText(/^ready:failed:/)).toBeInTheDocument());
  });

  it("does not guess who the user is when the profile fails to load", async () => {
    localStorage.setItem("access_token", "token");
    stubFetch({ rides: { status: 200, body: ridesBody("REQUESTED") }, me: { status: 500 } });
    renderWithIntl(<OaziGoProvider><Probe /></OaziGoProvider>);

    await waitFor(() => expect(screen.getByText(/^ready:failed:/)).toBeInTheDocument());
  });

  it("flags a failed driver lookup instead of treating it as 'not a driver'", async () => {
    localStorage.setItem("access_token", "token");
    stubFetch({ rides: { status: 200, body: ridesBody() }, driver: { status: 500 } });
    renderWithIntl(<OaziGoProvider><Probe /></OaziGoProvider>);

    await waitFor(() => expect(screen.getByText("ready:ok:driver-failed:fresh:none")).toBeInTheDocument());
  });

  it("refreshes active trips on its own and keeps showing them, marked stale, when a refresh fails", async () => {
    localStorage.setItem("access_token", "token");
    let reply: { status: number; body?: unknown } = { status: 200, body: ridesBody("REQUESTED") };
    const fetchMock = stubFetch({ rides: () => reply });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderWithIntl(<OaziGoProvider><Probe /></OaziGoProvider>);
    await waitFor(() => expect(screen.getByText("ready:ok:driver-ok:fresh:REQUESTED")).toBeInTheDocument());

    reply = { status: 200, body: ridesBody("ACCEPTED") };
    await act(async () => { await vi.advanceTimersByTimeAsync(8500); });
    await waitFor(() => expect(screen.getByText("ready:ok:driver-ok:fresh:ACCEPTED")).toBeInTheDocument());

    reply = { status: 503 };
    await act(async () => { await vi.advanceTimersByTimeAsync(8500); });
    await waitFor(() => expect(screen.getByText("ready:ok:driver-ok:stale:ACCEPTED")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalled();
  });
});
