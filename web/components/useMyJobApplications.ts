"use client";
import { useEffect, useState } from "react";
import { listMyJobApplications } from "@/lib/api";

// One request serves every Apply button on the page.
let cached: Promise<Map<string, string>> | null = null;
const listeners = new Set<() => void>();

/** Forgets what was fetched, so the buttons pick up a new application or a status change. */
export function refreshMyJobApplications() {
  cached = null;
  listeners.forEach((run) => run());
}

/** Job id → status of the signed-in user's own application. Empty when signed out or if the lookup fails. */
export function useMyJobApplications(): Map<string, string> {
  const [applications, setApplications] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let live = true;
    const run = () => {
      const token = localStorage.getItem("access_token");
      if (!token) return;
      cached ??= listMyJobApplications(token)
        .then((rows) => new Map(rows.map((row) => [row.job_posting, row.status] as const)))
        .catch(() => {
          cached = null;
          return new Map<string, string>();
        });
      void cached.then((map) => { if (live) setApplications(map); });
    };
    run();
    listeners.add(run);
    return () => {
      live = false;
      listeners.delete(run);
    };
  }, []);

  return applications;
}
