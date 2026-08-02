import { fetchWithRetry } from './httpRetry.js';
import { log as debugLog } from './debugLog.js';

const API_KEY = process.env.TMDB_API_KEY || '';
const API_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

// TMDB is the most reliable movie poster source around — far better coverage than Wikipedia
// (a non-trivial share of films, especially recent or international ones, have no lead image on
// their French or even English article) and without the rate-limiting that plagues Wikimedia.
// It's used as an additional poster fallback throughout the movie paths — when Wikipedia/Wikidata
// come up empty the poster is looked up here. No key configured → every call returns null and the
// existing Wikipedia/Wikidata chain is untouched, so the feature degrades gracefully.
export function isTmdbConfigured() {
  return Boolean(API_KEY);
}

function tmdbUrl(path) {
  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set('api_key', API_KEY);
  url.searchParams.set('language', 'fr-FR');
  return url;
}

// Search TMDB by title (and optional year) and return the poster URL for the best match.
// Returns null when nothing is configured or no poster could be found — callers treat that
// exactly like the Wikipedia/Wikidata sources being empty.
export async function findPoster(title, { year = null } = {}) {
  if (!API_KEY || !title) return null;
  try {
    const url = tmdbUrl('/search/movie');
    url.searchParams.set('query', title);
    if (year) url.searchParams.set('year', String(year));
    const resp = await fetchWithRetry(url);
    if (!resp.ok) {
      debugLog('http', `TMDB search '${title}' -> ${resp.status}`);
      return null;
    }
    const data = await resp.json();
    const movie = (data.results || []).find((m) => !!m.poster_path);
    if (movie) {
      debugLog('http', `TMDB poster trouvé pour '${title}': ${movie.poster_path}`);
      return `${IMAGE_BASE}${movie.poster_path}`;
    }
    return null;
  } catch (e) {
    debugLog('http', `TMDB search '${title}' a échoué : ${e.message}`);
    return null;
  }
}