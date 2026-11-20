import Image from "next/image";

export const NAV_ICONS = {
  ai: "/icons/nav/ai.png",
  car: "/icons/nav/icons8-car-100.png",
  cart: "/icons/nav/icons8-cart-94.png",
  celebration: "/icons/nav/icons8-celebration-50.png",
  chat: "/icons/nav/chat.png",
  gps: "/icons/nav/icons8-gps-48.png",
  hotel: "/icons/nav/icons8-hotel-64.png",
  market: "/icons/nav/store.png",
  user: "/icons/nav/user.png",
} as const;

/** Custom image icons (from /IMAGES, copied to public/icons) for sidebar entries they clearly match. */
export const NAV_ICON_BY_HREF: Record<string, string> = {
  "/wallet": "/icons/purse.png",
  "/messages": NAV_ICONS.chat,
  "/bookings": "/icons/transaction.png",
  "/landlord-portfolio": "/icons/analysis.png",
  "/dashboard": "/icons/analysis.png",
  "/technician-dashboard": "/icons/analysis.png",
  "/property-management": "/icons/monthly-billing.png",
  "/account": NAV_ICONS.user,
  "/agent-profile": NAV_ICONS.user,
  "/marketplace": NAV_ICONS.market,
  "/marketplace/my-listings": NAV_ICONS.market,
  "/marketplace/shop-settings": NAV_ICONS.market,
  "/marketplace/cart": NAV_ICONS.cart,
  "/oazigo": NAV_ICONS.car,
  "/driver-dashboard": NAV_ICONS.car,
  "/hotels": NAV_ICONS.hotel,
  "/hotel-dashboard": NAV_ICONS.hotel,
  "/events": NAV_ICONS.celebration,
  "/venue-dashboard": NAV_ICONS.celebration,
};

function createNavImageIcon(src: string, extraClassName = "") {
  return function CustomNavIcon({ size = 20, className = "" }: { size?: number; className?: string }) {
    return (
      <Image
        src={src}
        alt=""
        aria-hidden="true"
        width={size * 2}
        height={size * 2}
        style={{ width: size, height: size }}
        className={`shrink-0 object-contain ${extraClassName} ${className}`.trim()}
      />
    );
  };
}

export const NavAiIcon = createNavImageIcon(NAV_ICONS.ai);
export const NavCarIcon = createNavImageIcon(NAV_ICONS.car);
export const NavCartIcon = createNavImageIcon(NAV_ICONS.cart);
export const NavCelebrationIcon = createNavImageIcon(NAV_ICONS.celebration);
/** White-inverted variant of the line-art celebration icon for dark nav surfaces. */
export const NavCelebrationDarkIcon = createNavImageIcon(NAV_ICONS.celebration, "invert");
export const NavChatIcon = createNavImageIcon(NAV_ICONS.chat);
export const NavGpsIcon = createNavImageIcon(NAV_ICONS.gps);
export const NavHotelIcon = createNavImageIcon(NAV_ICONS.hotel);
export const NavMarketIcon = createNavImageIcon(NAV_ICONS.market);
export const NavUserIcon = createNavImageIcon(NAV_ICONS.user);

export default function NavIconImage({ src, size = 16 }: { src: string; size?: number }) {
  return (
    <span className="inline-flex items-center justify-center rounded-md bg-white p-0.5 shadow-sm">
      <Image src={src} alt="" aria-hidden="true" width={size * 2} height={size * 2} style={{ width: size, height: size }} className="object-contain" />
    </span>
  );
}
