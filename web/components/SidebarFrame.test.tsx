import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import SidebarFrame from "./SidebarFrame";
import { renderWithIntl } from "./oazigo/test-utils";

const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/wallet",
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/api", () => ({
  getMyProfile: vi.fn(() => new Promise(() => {})),
  devSwitchRole: vi.fn(),
}));
vi.mock("@/lib/push", () => ({ disablePush: vi.fn() }));

function renderFrame() {
  return renderWithIntl(
    <SidebarFrame sidebar={<p>Account nav</p>}>
      <p>Private page</p>
    </SidebarFrame>,
  );
}

describe("SidebarFrame", () => {
  beforeEach(() => {
    localStorage.clear();
    replace.mockClear();
  });

  it("sends signed-out visitors to sign in, returning here, without showing the sidebar or page", async () => {
    renderFrame();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?next=%2Fwallet"));
    expect(screen.queryByText("Account nav")).toBeNull();
    expect(screen.queryByText("Private page")).toBeNull();
  });

  it("shows the sidebar and page to signed-in users", async () => {
    localStorage.setItem("access_token", "token");
    renderFrame();

    expect(await screen.findByText("Account nav")).toBeTruthy();
    expect(screen.getByText("Private page")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
});
