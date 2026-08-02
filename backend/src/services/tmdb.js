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

// Title comparison is accent/case-insensitive so "Les Rayons et les Ombres" matches regardless of
// how TMDB localized it — but deliberately keeps punctuation, since short titles like "Bagarre"
// are exactly where a loose fuzzy match picks up an unrelated film.
function normalizeTitle(title) {
  return (title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

async function searchResults(title, year) {
  const url = tmdbUrl('/search/movie');
  url.searchParams.set('query', title);
  if (year) url.searchParams.set('year', String(year));
  const resp = await fetchWithRetry(url);
  if (!resp.ok) {
    debugLog('http', `TMDB search '${title}'${year ? ` (${year})` : ''} -> ${resp.status}`);
    return [];
  }
  const data = await resp.json();
  return data.results || [];
}

// Search TMDB by title (and optional year) and return the poster URL for the best match.
// Returns null when nothing is configured or no poster could be found — callers treat that
// exactly like the Wikipedia/Wikidata sources being empty.
//
// Two things the naive "first result with a poster" missed, which is what left recent/upcoming
// films posterless in the list:
//   - the year filter is strict: an upcoming film, or one whose cached release year doesn't line up
//     with TMDB's, comes back empty even though the bare title search finds it — so when the
//     year-filtered search finds nothing, retry without the year;
//   - the first result isn't always the film: short/common titles can rank another movie first (e.g.
//     there are two unrelated films named "Bagarre"), so prefer an exact title match, then one whose
//     release year agrees, and only then fall back to whatever TMDB ranked highest.
export async function findPoster(title, { year = null } = {}) {
  if (!title) return null;
  if (!API_KEY) {
    debugLog('http', 'TMDB : TMDB_API_KEY non configurée, pas de recherche d’affiche TMDB.');
    return null;
  }
  try {
    let results = await searchResults(title, year);
    if (!results.length && year) results = await searchResults(title, null);

    const target = normalizeTitle(title);
    let fallback = null;
    for (const m of results) {
      if (!m.poster_path) continue;
      fallback = fallback || m;
      if (normalizeTitle(m.title) !== target) continue;
      const mYear = (m.release_date || '').slice(0, 4);
      if (!year || mYear === String(year)) {
        debugLog('http', `TMDB poster trouvé pour '${title}': ${m.poster_path}`);
        return `${IMAGE_BASE}${m.poster_path}`;
      }
    }
    if (fallback) {
      debugLog('http', `TMDB poster (meilleur match) pour '${title}': ${fallback.poster_path}`);
      return `${IMAGE_BASE}${fallback.poster_path}`;
    }
    return null;
  } catch (e) {
    debugLog('http', `TMDB search '${title}' a échoué : ${e.message}`);
    return null;
  }
}