/** A real skeleton grid for client-rendered pages that fetch after
 * mount (Feed, Favorites, etc.) — replaces a bare "..." or a plain
 * spinner with a shape that hints at the real content about to load. */
export default function LoadingState({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border border-gray-200 rounded-xl overflow-hidden bg-white animate-pulse">
          <div className="h-40 bg-gray-100" />
          <div className="p-4 space-y-2">
            <div className="h-3 bg-gray-100 rounded w-2/3" />
            <div className="h-3 bg-gray-100 rounded w-1/2" />
            <div className="h-5 bg-gray-100 rounded w-1/3 mt-3" />
          </div>
        </div>
      ))}
    </div>
  );
}
