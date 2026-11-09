"use client";
import { useEffect, useRef } from "react";
import { useLocale } from "next-intl";

/**
 * A number that counts up from zero the first time it scrolls into view. The final value is
 * rendered on the server, so it's correct without JavaScript and for reduced-motion users.
 */
export default function CountUp({ value, durationMs = 1600 }: { value: number; durationMs?: number }) {
  const locale = useLocale();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const format = new Intl.NumberFormat(locale);
    let frame = 0;

    const run = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / durationMs);
        el.textContent = format.format(Math.round(value * (1 - Math.pow(1 - progress, 3))));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      run();
    }, { threshold: 0.4 });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, locale, durationMs]);

  return <span ref={ref} className="tabular-nums">{new Intl.NumberFormat(locale).format(value)}</span>;
}
