"use client";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** True once the element has scrolled into view (and stays true). */
function useSeen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      void Promise.resolve().then(() => setSeen(true));
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setSeen(true);
        observer.disconnect();
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, seen] as const;
}

/** Fades and slides its content in when it scrolls into view. `soft` is a smaller move for big full-width sections. */
export default function Reveal({
  children, className = "", delay = 0, soft = false,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  soft?: boolean;
}) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`reveal ${soft ? "reveal-soft" : ""} ${seen ? "is-visible" : ""} ${className}`}
      style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

/** Like Reveal, but each direct child enters one after another (a staggered cascade). */
export function RevealGroup({ children, className = "" }: { children: ReactNode; className?: string }) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  return (
    <div ref={ref} className={`reveal-group ${seen ? "is-visible" : ""} ${className}`}>
      {children}
    </div>
  );
}
