const MOMENT = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/;

export const MOMENT_FORMAT_HINT = "YYYY-MM-DD HH:MM";

/**
 * Reads a date typed as "YYYY-MM-DD" or "YYYY-MM-DD HH:MM" in the phone's local time and returns it as an ISO
 * string. A bare date means the start of that day, or its last minute when `endOfDay` is set. Returns null for
 * blank or impossible input (2030-02-31, 25:00...).
 */
export function parseMoment(text: string, endOfDay = false): string | null {
  const match = MOMENT.exec(text.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const timed = match[4] !== undefined;
  const hour = timed ? Number(match[4]) : endOfDay ? 23 : 0;
  const minute = timed ? Number(match[5]) : endOfDay ? 59 : 0;
  const date = new Date(year, month - 1, day, hour, minute);
  const valid = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    && date.getHours() === hour && date.getMinutes() === minute;
  return valid ? date.toISOString() : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The inverse of parseMoment, for filling an edit field from a stored ISO moment. */
export function formatMoment(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A plain calendar day (YYYY-MM-DD) such as a vacation end date; null when it is not a real date. */
export function parseDay(text: string): string | null {
  const trimmed = text.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return parseMoment(trimmed) ? trimmed : null;
}
