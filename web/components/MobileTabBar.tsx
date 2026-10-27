"use client";
import { useEffect, type ReactNode } from "react";
import { Link } from "@/i18n/navigation";

export interface MobileTabItem {
  id: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  href?: string;
  onClick?: () => void;
  /** Marks a tab that opens a sheet (not a page) for assistive tech. */
  expanded?: boolean;
  /** Raised centre call-to-action, like a native app's main action button. */
  primary?: boolean;
}

/**
 * Native-app style bottom tab bar, visible on phones only. While mounted it
 * flags <body> so global CSS can reserve space for it and lift floating widgets.
 */
export default function MobileTabBar({ items, label }: { items: MobileTabItem[]; label: string }) {
  useEffect(() => {
    document.body.dataset.mobileNav = "true";
    return () => {
      delete document.body.dataset.mobileNav;
    };
  }, []);

  return (
    <nav
      aria-label={label}
      className="md:hidden fixed inset-x-0 bottom-0 z-[60] border-t border-white/10 bg-slate-900/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.5)]"
    >
      <ul className="mx-auto flex max-w-lg items-end justify-around px-1">
        {items.map((item) => {
          const content = item.primary ? (
            <>
              <span className={`-mt-6 flex h-14 w-14 items-center justify-center rounded-full border-4 border-slate-900 bg-gradient-to-br from-amber-300 to-amber-500 text-slate-950 shadow-lg shadow-amber-500/30 transition-transform active:scale-90 ${item.active ? "ring-2 ring-amber-300/60" : ""}`}>
                {item.icon}
              </span>
              <span className={`mt-0.5 text-[10px] font-bold ${item.active ? "text-amber-300" : "text-slate-300"}`}>{item.label}</span>
            </>
          ) : (
            <>
              <span className={`absolute top-0 h-0.5 w-8 rounded-full transition-colors ${item.active ? "bg-amber-400" : "bg-transparent"}`} />
              <span className={`transition-transform active:scale-90 ${item.active ? "text-amber-300" : "text-slate-400"}`}>{item.icon}</span>
              <span className={`mt-1 text-[10px] font-bold ${item.active ? "text-amber-300" : "text-slate-400"}`}>{item.label}</span>
            </>
          );
          const cls = "relative flex min-h-14 w-full flex-col items-center justify-center pb-1.5 pt-2 select-none [-webkit-tap-highlight-color:transparent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded-lg";
          return (
            <li key={item.id} className="flex-1">
              {item.href ? (
                <Link href={item.href} className={cls} aria-current={item.active ? "page" : undefined}>{content}</Link>
              ) : (
                <button type="button" onClick={item.onClick} className={`${cls} cursor-pointer`} aria-haspopup={item.expanded === undefined ? undefined : "dialog"} aria-expanded={item.expanded} aria-current={item.active && item.expanded === undefined ? "true" : undefined}>{content}</button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
