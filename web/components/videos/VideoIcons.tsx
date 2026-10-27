import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  "aria-hidden": true as const,
});

export function HeartFilled({ size = 30, ...props }: P) {
  return (
    <svg {...base(size)} fill="currentColor" {...props}>
      <path d="M12 21.35 10.55 20C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09A6.01 6.01 0 0 1 16.5 3C19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35Z" />
    </svg>
  );
}

export function HeartOutline({ size = 30, ...props }: P) {
  return (
    <svg {...base(size)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" {...props}>
      <path d="M12 20.5C5.5 14.9 3 12 3 8.8 3 6.4 4.9 4.5 7.3 4.5c1.8 0 3.5 1 4.7 2.6 1.2-1.6 2.9-2.6 4.7-2.6C19.1 4.5 21 6.4 21 8.8c0 3.2-2.5 6.1-9 11.7Z" />
    </svg>
  );
}

export function CommentIcon({ size = 30, ...props }: P) {
  return (
    <svg {...base(size)} fill="currentColor" {...props}>
      <path d="M12 3C6.48 3 2 6.92 2 11.75c0 2.2.93 4.2 2.46 5.74-.2 1.5-.9 2.86-1.9 3.9a.5.5 0 0 0 .4.84c2.1-.1 3.9-.84 5.2-1.78 1.2.4 2.5.6 3.84.6 5.52 0 10-3.92 10-8.75S17.52 3 12 3Zm-4 9.5a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm4 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm4 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z" />
    </svg>
  );
}

export function BookmarkIcon({ size = 30, filled = false, ...props }: P & { filled?: boolean }) {
  return (
    <svg {...base(size)} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" {...props}>
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

export function ShareArrowIcon({ size = 30, ...props }: P) {
  return (
    <svg {...base(size)} fill="currentColor" {...props}>
      <path d="M14 4.5v4.1c-5.2.4-9 3.5-10 9.4 2.2-3 5.2-4.2 10-4.4v4.1a.6.6 0 0 0 1 .4l7.6-7.2a.6.6 0 0 0 0-.9L15 4.1a.6.6 0 0 0-1 .4Z" />
    </svg>
  );
}

export function VolumeIcon({ size = 26, muted = false, ...props }: P & { muted?: boolean }) {
  return (
    <svg {...base(size)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" />
      {muted ? (
        <path d="m16 9 5 6m0-6-5 6" />
      ) : (
        <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
      )}
    </svg>
  );
}

export function PlayIcon({ size = 64, ...props }: P) {
  return (
    <svg {...base(size)} fill="currentColor" {...props}>
      <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.9-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

export function PlusIcon({ size = 14, ...props }: P) {
  return (
    <svg {...base(size)} fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function CheckIcon({ size = 14, ...props }: P) {
  return (
    <svg {...base(size)} fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}
