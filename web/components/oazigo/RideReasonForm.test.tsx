import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import RideReasonForm from "./RideReasonForm";
import { RIDE_CANCEL_REASONS } from "@/lib/api";
import { renderWithIntl } from "./test-utils";

describe("RideReasonForm", () => {
  it("only confirms once a reason is picked, and passes the trimmed note", () => {
    const onConfirm = vi.fn();
    renderWithIntl(
      <RideReasonForm
        title="Why are you cancelling?" reasons={RIDE_CANCEL_REASONS} labelPrefix="cancelReason"
        confirmLabel="Cancel ride" busy={false} onConfirm={onConfirm} onBack={() => {}}
      />,
    );
    const confirm = screen.getByRole("button", { name: "Cancel ride" });
    expect(confirm).toBeDisabled();
    // The expiry-only reason is never offered to a rider.
    expect(screen.queryByText(/no driver accepted in time/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Waited too long"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  20 minutes  " } });
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith("WAITED_TOO_LONG", "20 minutes");
  });
});
