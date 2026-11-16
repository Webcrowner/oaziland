import { useEffect, useState } from "react";
import { countdownLabel, countdownTickMs } from "./flashSale";

/** The live "Ends in ..." text for a sale: ticks every second in the last hour and every 30 seconds before that. */
export function useCountdown(endsAt: string | null | undefined): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!endsAt) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const current = Date.now();
      setNow(current);
      if (new Date(endsAt).getTime() <= current) return;
      timer = setTimeout(schedule, countdownTickMs(endsAt, current));
    };
    schedule();
    return () => { if (timer) clearTimeout(timer); };
  }, [endsAt]);

  return countdownLabel(endsAt, now);
}
