"use client";

/**
 * Root-level error boundary — catches failures in the root layout
 * itself (above the locale segment), where no locale/translation
 * context exists yet. Must render its own <html>/<body> per Next.js's
 * global-error.tsx contract, since it replaces the root layout too.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html>
      <body className="min-h-screen flex items-center justify-center font-sans">
        <div className="max-w-md px-4 py-20 text-center">
          <p className="text-4xl mb-4">⚠️</p>
          <h1 className="text-xl font-bold mb-2">Something went wrong</h1>
          <p className="text-sm text-gray-500 mb-8">
            An unexpected error occurred. Please try again, or return to the homepage.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button onClick={reset} className="bg-slate-900 text-white font-semibold px-6 py-3 rounded hover:opacity-90">
              Try Again
            </button>
            <a href="/" className="text-sm font-semibold text-gray-600 underline">
              Go Home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
