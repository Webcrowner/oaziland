import Image from "next/image";

/** Custom image icons (from /IMAGES, copied to public/icons) for sidebar entries they clearly match. */
export const NAV_ICON_BY_HREF: Record<string, string> = {
  "/wallet": "/icons/purse.png",
  "/messages": "/icons/chat.png",
  "/bookings": "/icons/transaction.png",
  "/landlord-portfolio": "/icons/analysis.png",
  "/dashboard": "/icons/analysis.png",
  "/technician-dashboard": "/icons/analysis.png",
  "/property-management": "/icons/monthly-billing.png",
};

export default function NavIconImage({ src, size = 16 }: { src: string; size?: number }) {
  return (
    <span className="inline-flex items-center justify-center rounded-md bg-white p-0.5 shadow-sm">
      <Image src={src} alt="" width={size * 2} height={size * 2} style={{ width: size, height: size }} className="object-contain" />
    </span>
  );
}
