// A rating badge and platform chips, both backed by JustWatch (see backend/src/services/justwatch.js)
// and both linking out to the title's JustWatch page — the one place that actually aggregates
// real per-platform availability and a score, which neither TVmaze nor Wikipedia expose on their own.
export function RatingBadge({ score, url }) {
  if (!score) return null;
  const content = <>· ⭐ {score.toFixed(1)}</>;
  if (!url) return <span>{content}</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="hover:text-accent-500 hover:underline">
      {content}
    </a>
  );
}

export function PlatformRow({ platforms, url, fallback }) {
  if (platforms?.length > 0) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-gray-400">📺 Disponible sur</span>
        {platforms.map((p) => (
          url ? (
            <a
              key={p}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="bg-base-800 border border-base-700 hover:border-accent-500 hover:text-accent-500 rounded-full px-2.5 py-1 text-gray-300 transition-colors"
            >
              {p}
            </a>
          ) : (
            <span key={p} className="bg-base-800 border border-base-700 rounded-full px-2.5 py-1 text-gray-300">
              {p}
            </span>
          )
        ))}
      </div>
    );
  }
  // No JustWatch match for this title (rare) — fall back to the single platform mention TVmaze/
  // Wikipedia sometimes carry, if there is one.
  if (fallback) return <p className="text-xs text-gray-400">📺 Disponible sur {fallback}</p>;
  return null;
}
