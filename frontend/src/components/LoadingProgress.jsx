import { useEffect, useState } from 'react';

// A bare "Chargement…" gives no signal that anything is actually happening once a lookup runs
// long — on a Wikipedia/Wikidata rate-limited day (see debug mode in Admin) that can stretch to
// tens of seconds, and a static line just reads as frozen. A spinner plus a running counter, with
// the message escalating once it's clearly taking a while, keeps that distinction visible instead
// of leaving the user to wonder if it's stuck.
export function useElapsedSeconds(active) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) { setSeconds(0); return; }
    const start = Date.now();
    const handle = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(handle);
  }, [active]);
  return seconds;
}

export function LoadingProgress({ seconds, className = '' }) {
  const message = seconds < 5
    ? 'Chargement…'
    : seconds < 15
      ? 'Toujours en cours…'
      : 'Une source externe répond lentement, ça arrive — encore un instant…';
  return (
    <div className={`flex items-center gap-2 text-sm text-gray-400 ${className}`}>
      <span className="w-4 h-4 border-2 border-gray-600 border-t-accent-500 rounded-full animate-spin shrink-0" />
      <span>{message}{seconds > 0 ? ` (${seconds}s)` : ''}</span>
    </div>
  );
}
