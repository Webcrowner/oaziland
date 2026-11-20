/** Pickup and drop-off as a vertical route, so a trip reads as one journey rather than two unrelated lines of text. */
export default function RouteStops({ pickup, dropoff, pickupLabel, dropoffLabel }: {
  pickup: string;
  dropoff: string;
  pickupLabel: string;
  dropoffLabel: string;
}) {
  return (
    <ol className="relative flex flex-col gap-3 pl-7">
      <span aria-hidden="true" className="absolute left-[9px] top-4 bottom-4 w-px border-l-2 border-dashed border-slate-300" />
      <li className="relative min-w-0">
        <span aria-hidden="true" className="absolute -left-7 top-0.5 flex h-[19px] w-[19px] items-center justify-center rounded-full bg-amber-400 ring-4 ring-amber-100">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-950" />
        </span>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{pickupLabel}</p>
        <p className="break-words text-sm font-bold leading-snug text-slate-900">{pickup}</p>
      </li>
      <li className="relative min-w-0">
        <span aria-hidden="true" className="absolute -left-7 top-0.5 flex h-[19px] w-[19px] items-center justify-center rounded-full bg-emerald-600 ring-4 ring-emerald-100">
          <span className="h-1.5 w-1.5 rounded-full bg-white" />
        </span>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{dropoffLabel}</p>
        <p className="break-words text-sm font-bold leading-snug text-slate-900">{dropoff}</p>
      </li>
    </ol>
  );
}
