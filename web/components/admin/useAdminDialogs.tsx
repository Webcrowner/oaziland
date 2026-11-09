"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

interface PromptOptions {
  title?: string;
  defaultValue?: string;
  placeholder?: string;
  /** Render a multi-line box instead of a single line. */
  multiline?: boolean;
  /** The value must be non-blank. */
  required?: boolean;
  /** Return an error message to block submission, or null when the value is fine. */
  validate?: (value: string) => string | null;
  confirmLabel?: string;
  /** Adds a tick-box under the field, e.g. "Also issue a strike". */
  optionLabel?: string;
}

interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

type Request =
  | { kind: "prompt"; message: string; options: PromptOptions; resolve: (v: { value: string; checked: boolean } | null) => void }
  | { kind: "confirm"; message: string; options: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "notice"; message: string; resolve: () => void };

/**
 * In-page replacements for the browser's prompt(), confirm() and alert(), which are blocked or unsupported in
 * embedded views, installed apps and some mobile browsers (and look out of place everywhere else). Each call
 * returns a promise like the native one did; cancelling (Cancel, Esc or a click outside) resolves null/false.
 * Render `element` once somewhere in the page.
 */
export function useAdminDialogs() {
  const t = useTranslations("AdminConsolePage");
  const [request, setRequest] = useState<Request | null>(null);
  const [value, setValue] = useState("");
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const open = useCallback((next: Request, initial = "") => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setValue(initial);
    setChecked(false);
    setError("");
    // A dialog opened over another one cancels the first so its caller is never left waiting.
    setRequest((previous) => {
      if (previous?.kind === "prompt") previous.resolve(null);
      else if (previous?.kind === "confirm") previous.resolve(false);
      else if (previous?.kind === "notice") previous.resolve();
      return next;
    });
  }, []);

  const askWithOption = useCallback(
    (message: string, options: PromptOptions = {}) =>
      new Promise<{ value: string; checked: boolean } | null>((resolve) => open({ kind: "prompt", message, options, resolve }, options.defaultValue ?? "")),
    [open],
  );
  const ask = useCallback(
    async (message: string, options: PromptOptions = {}) => (await askWithOption(message, options))?.value ?? null,
    [askWithOption],
  );
  const confirm = useCallback(
    (message: string, options: ConfirmOptions = {}) => new Promise<boolean>((resolve) => open({ kind: "confirm", message, options, resolve })),
    [open],
  );
  const notify = useCallback((message: string) => new Promise<void>((resolve) => open({ kind: "notice", message, resolve })), [open]);

  function close() {
    setRequest(null);
    returnFocus.current?.focus();
  }

  function cancel() {
    if (!request) return;
    if (request.kind === "prompt") request.resolve(null);
    else if (request.kind === "confirm") request.resolve(false);
    else request.resolve();
    close();
  }

  function submit() {
    if (!request) return;
    if (request.kind === "prompt") {
      const trimmed = value.trim();
      const { required, validate } = request.options;
      const problem = required && !trimmed ? t("dialogRequired") : validate?.(trimmed) ?? null;
      if (problem) {
        setError(problem);
        fieldRef.current?.focus();
        return;
      }
      request.resolve({ value: trimmed, checked });
    } else if (request.kind === "confirm") {
      request.resolve(true);
    } else {
      request.resolve();
    }
    close();
  }

  useEffect(() => {
    if (!request) return;
    (request.kind === "prompt" ? fieldRef.current : primaryRef.current)?.focus();
  }, [request]);

  const options = request && request.kind !== "notice" ? request.options : null;
  const title = options?.title;
  const destructive = request?.kind === "confirm" && request.options.destructive;
  const confirmLabel = options?.confirmLabel ?? (request?.kind === "notice" ? t("dialogOk") : t("dialogConfirm"));

  const element: ReactNode = request && (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-950/50 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && request.kind !== "notice") cancel(); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); cancel(); } }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="admin-dialog-message" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        {title && <h2 className="mb-1 text-base font-bold text-slate-900">{title}</h2>}
        <p id="admin-dialog-message" className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{request.message}</p>

        {request.kind === "prompt" && (
          <div className="mt-4">
            {request.options.multiline ? (
              <textarea
                ref={fieldRef} rows={3} value={value} placeholder={request.options.placeholder}
                onChange={(e) => { setValue(e.target.value); setError(""); }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                aria-describedby="admin-dialog-message" aria-invalid={Boolean(error)}
              />
            ) : (
              <input
                ref={fieldRef} value={value} placeholder={request.options.placeholder}
                onChange={(e) => { setValue(e.target.value); setError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
                aria-describedby="admin-dialog-message" aria-invalid={Boolean(error)}
              />
            )}
            {error && <p role="alert" className="mt-1.5 text-xs font-semibold text-rose-600">{error}</p>}
            {request.options.optionLabel && (
              <label className="mt-3 flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5" />
                <span>{request.options.optionLabel}</span>
              </label>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          {request.kind !== "notice" && (
            <button type="button" onClick={cancel} className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer">
              {t("dialogCancel")}
            </button>
          )}
          <button
            ref={primaryRef} type="button" onClick={submit}
            className={`rounded-xl px-4 py-2 text-sm font-bold text-white cursor-pointer ${destructive ? "bg-rose-600 hover:bg-rose-500" : "bg-slate-900 hover:bg-slate-800"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  return { element, ask, askWithOption, confirm, notify };
}
