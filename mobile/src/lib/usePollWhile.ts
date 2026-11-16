import { useEffect, useRef } from "react";

/** Calls `tick` every few seconds while `active`, and gives up after `maxMs`. Used to watch for a Mobile Money payment
 * that the provider confirms after the payer approves it on their phone. */
export function usePollWhile(active: boolean, tick: () => void, onGiveUp: () => void, maxMs = 8 * 60 * 1000, everyMs = 3000) {
  const latest = useRef({ tick, onGiveUp });
  useEffect(() => {
    latest.current = { tick, onGiveUp };
  });
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > maxMs) {
        clearInterval(timer);
        latest.current.onGiveUp();
      } else {
        latest.current.tick();
      }
    }, everyMs);
    return () => clearInterval(timer);
  }, [active, maxMs, everyMs]);
}
