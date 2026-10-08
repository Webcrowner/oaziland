"use client";
import { useState, useEffect } from "react";
import { Link } from "@/i18n/navigation";

export interface TickerItem {
  text: string;
  link: string;
}

/** Rotating headline strip; every item is built from live platform counts by the caller. */
export default function LiveMarketTicker({ items, label }: { items: TickerItem[]; label: string }) {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (items.length < 2) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % items.length);
    }, 4500);
    return () => clearInterval(timer);
  }, [items.length]);

  if (items.length === 0) return null;
  const currentItem = items[currentIndex % items.length];

  return (
    <div className="bg-[#0B132B] border-b border-slate-800 text-xs py-2 px-4 overflow-hidden relative z-30">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 shrink-0">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
          <span className="font-extrabold uppercase tracking-widest text-[10px] text-amber-400">{label}</span>
        </div>

        <div className="flex-1 overflow-hidden text-center sm:text-left transition-opacity duration-300">
          <Link
            href={currentItem.link}
            className="text-slate-200 hover:text-amber-300 transition-colors font-medium truncate block"
          >
            {currentItem.text}
          </Link>
        </div>
      </div>
    </div>
  );
}
