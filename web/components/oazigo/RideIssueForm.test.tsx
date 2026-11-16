import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import RideIssueForm from "./RideIssueForm";
import { renderWithIntl } from "./test-utils";

describe("RideIssueForm", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("doesn't let a rider report rider behaviour, or a driver report driver behaviour", () => {
    const { unmount } = renderWithIntl(<RideIssueForm rideId="r1" isDriver={false} />);
    fireEvent.click(screen.getByText("Report a problem with this trip"));
    expect(screen.getByRole("option", { name: "Driver behaviour" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Rider behaviour" })).not.toBeInTheDocument();
    unmount();

    renderWithIntl(<RideIssueForm rideId="r1" isDriver />);
    fireEvent.click(screen.getByText("Report a problem with this trip"));
    expect(screen.getByRole("option", { name: "Rider behaviour" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Driver behaviour" })).not.toBeInTheDocument();
  });

  it("sends the report and confirms, or shows the server's reason when refused", async () => {
    localStorage.setItem("access_token", "token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "You already reported a problem with this ride." }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 1, status: "OPEN" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    renderWithIntl(<RideIssueForm rideId="r1" isDriver={false} />);
    fireEvent.click(screen.getByText("Report a problem with this trip"));
    const send = screen.getByRole("button", { name: "Send report" });
    fireEvent.change(screen.getByLabelText("What went wrong?"), { target: { value: "FARE" } });
    fireEvent.change(screen.getByLabelText("Tell us what happened"), { target: { value: "short" } });
    expect(send).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Tell us what happened"), { target: { value: "Asked for extra cash at drop-off." } });
    fireEvent.click(send);
    expect(await screen.findByRole("alert")).toHaveTextContent("You already reported a problem with this ride.");

    fireEvent.click(send);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/your report was sent/i));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toMatch(/\/api\/rides\/r1\/report-issue\/$/);
    expect(JSON.parse(init.body)).toEqual({ category: "FARE", description: "Asked for extra cash at drop-off." });
  });
});
