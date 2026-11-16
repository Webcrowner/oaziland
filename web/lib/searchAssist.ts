export const ASSIST_MIN_CHARS = 3;
export const ASSIST_DEBOUNCE_MS = 400;
export const IMAGE_SEARCH_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const IMAGE_SEARCH_MAX_BYTES = 5 * 1024 * 1024;

/** The spelling suggestion worth showing for what is typed now: none when it is stale, empty or the same words. */
export function suggestionFor(q: string, assist: { query: string; did_you_mean: string | null } | null): string | null {
  const typed = q.trim().replace(/\s+/g, " ");
  if (!assist || !assist.did_you_mean || typed.length < ASSIST_MIN_CHARS) return null;
  if (assist.query.trim().replace(/\s+/g, " ").toLowerCase() !== typed.toLowerCase()) return null;
  const suggestion = assist.did_you_mean.trim();
  return suggestion && suggestion.toLowerCase() !== typed.toLowerCase() ? suggestion : null;
}

export function imageProblem(file: { type: string; size: number }): "type" | "size" | null {
  if (!IMAGE_SEARCH_TYPES.includes(file.type)) return "type";
  return file.size > IMAGE_SEARCH_MAX_BYTES ? "size" : null;
}

export interface SpeechResultEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** The browser's speech recognizer, or null where the Web Speech API isn't available. */
export function getSpeechRecognition(win: object | undefined = typeof window === "undefined" ? undefined : window): SpeechRecognitionCtor | null {
  if (!win) return null;
  const source = win as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return source.SpeechRecognition ?? source.webkitSpeechRecognition ?? null;
}

export function transcriptOf(event: SpeechResultEventLike): string {
  const first = event.results[0]?.[0]?.transcript ?? "";
  return first.trim();
}
