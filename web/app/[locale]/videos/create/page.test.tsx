import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import CreateVideoPage from "./page";
import { renderWithIntl } from "@/components/oazigo/test-utils";

const mocks = vi.hoisted(() => ({ codec: "h264" }));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/videos/create",
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("listing_id=abc-1") }));
vi.mock("@/lib/api", () => ({
  createPost: vi.fn(),
  CreatePostError: class extends Error {},
  listMyListings: vi.fn(() => Promise.resolve({ results: [] })),
}));
vi.mock("@/components/MediaUploader", () => ({
  default: ({ onUploaded }: { onUploaded: (r: { url: string; media_type: "VIDEO"; video_codec: string }) => void }) => (
    <button type="button" onClick={() => onUploaded({ url: "http://localhost:8000/media/videos/a.mov", media_type: "VIDEO", video_codec: mocks.codec })}>
      pick video
    </button>
  ),
}));

describe("Post a video page", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.codec = "h264";
  });

  it("sends a signed-out visitor to sign in and back here, keeping the property they came to link", async () => {
    renderWithIntl(<CreateVideoPage />);

    const link = await screen.findByRole("link", { name: "Sign in" });
    expect(link).toHaveAttribute("href", `/login?next=${encodeURIComponent("/videos/create?listing_id=abc-1")}`);
  });

  it("warns that an HEVC video may not play for everyone, but not for a normal H.264 one", async () => {
    localStorage.setItem("access_token", "token");
    mocks.codec = "hevc";
    renderWithIntl(<CreateVideoPage />);
    fireEvent.click(await screen.findByRole("button", { name: "pick video" }));
    expect(await screen.findByRole("note")).toHaveTextContent("HEVC");
  });

  it("shows no warning for a standard H.264 video", async () => {
    localStorage.setItem("access_token", "token");
    renderWithIntl(<CreateVideoPage />);
    fireEvent.click(await screen.findByRole("button", { name: "pick video" }));
    await screen.findByRole("button", { name: "Remove video" });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
