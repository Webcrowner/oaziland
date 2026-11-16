"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getMarketplaceCart } from "@/lib/api";
import { CART_CHANGED_EVENT } from "@/lib/cartEvents";

export function CartIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M2 3h3l2.6 12.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20.5 7H6" />
    </svg>
  );
}

/** The marketplace cart icon with the number of items in it, linking to the cart. */
export default function CartLink({ className = "" }: { className?: string }) {
  const t = useTranslations("MarketplaceCart");
  const [count, setCount] = useState(0);

  useEffect(() => {
    const load = () => {
      const token = localStorage.getItem("access_token");
      if (!token) {
        setCount(0);
        return;
      }
      getMarketplaceCart(token).then((cart) => setCount(cart.item_count)).catch(() => {});
    };
    const timer = setTimeout(load, 0);
    window.addEventListener(CART_CHANGED_EVENT, load);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(CART_CHANGED_EVENT, load);
    };
  }, []);

  return (
    <Link
      href="/marketplace/cart"
      aria-label={count > 0 ? t("cartWithCount", { count }) : t("myCart")}
      className={`relative inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-[var(--navy)] hover:border-[var(--navy)] ${className}`}
    >
      <CartIcon />
      <span className="hidden sm:inline">{t("myCart")}</span>
      {count > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-bold text-white">{count}</span>
      )}
    </Link>
  );
}
