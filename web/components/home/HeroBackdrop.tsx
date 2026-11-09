"use client";
import Image from "next/image";
import { useEffect, useRef } from "react";

/**
 * The hero photo: it slowly zooms and pans on its own (Ken Burns) and drifts slower than the
 * page as you scroll (parallax). Must sit inside a `relative overflow-hidden` section.
 */
export default function HeroBackdrop() {
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = layer.current;
    const section = el?.parentElement;
    if (!el || !section || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;

    const update = () => {
      frame = 0;
      const rect = section.getBoundingClientRect();
      if (rect.bottom < 0) return;
      const shift = Math.min(Math.max(-rect.top, 0) * 0.18, rect.height * 0.09);
      el.style.transform = `translate3d(0, ${shift}px, 0)`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={layer} className="pointer-events-none absolute inset-x-0 -top-[10%] -bottom-[10%] will-change-transform">
      <div className="ken-burns absolute inset-0">
        <Image
          src="/images/hero-trust-cameroon.png"
          alt=""
          fill
          preload
          sizes="100vw"
          className="object-cover object-center"
        />
      </div>
    </div>
  );
}
