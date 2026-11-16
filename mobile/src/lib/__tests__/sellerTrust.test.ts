import { lastSeenLabel, replyTimeLabel } from "../sellerTrust";

describe("seller trust labels", () => {
  it("rounds the reply time up into hours or days", () => {
    expect(replyTimeLabel(0.4)).toBe("Usually replies within an hour");
    expect(replyTimeLabel(2.2)).toBe("Usually replies within 3 hours");
    expect(replyTimeLabel(30)).toBe("Usually replies within 2 days");
  });

  it("describes when the seller was last seen", () => {
    const now = new Date("2030-01-10T12:00:00Z");
    expect(lastSeenLabel("2030-01-10T11:58:00Z", now)).toBe("Active now");
    expect(lastSeenLabel("2030-01-10T11:00:00Z", now)).toBe("Last seen 1 hour ago");
    expect(lastSeenLabel("2030-01-08T12:00:00Z", now)).toBe("Last seen 2 days ago");
  });
});
