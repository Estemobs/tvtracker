import { fetchWithRetry } from './httpRetry.js';

const LOOKUP_URL = 'https://itunes.apple.com/lookup';
const SEARCH_URL = 'https://itunes.apple.com/search';
const CHART_URL = 'https://itunes.apple.com/fr/rss/topmovies/limit=40/json';

function upscaleArtwork(url) {
  return url ? url.replace(/\d+x\d+bb\.(jpg|png)$/, '600x600bb.$1') : null;
}

function normalizeTitle(title) {
  return (title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function mapSearchEntry(movie) {
  return {
    source: 'itunes',
    source_id: movie.trackId ? String(movie.trackId) : null,
    imdb_id: null,
    media_type: 'movie',
    type: 'movie',
    title: movie.trackName || '',
    poster: upscaleArtwork(movie.artworkUrl100),
    year: (movie.releaseDate || '').slice(0, 4),
    note: null,
    genre: movie.primaryGenreName || null,
  };
}

function mapChartEntry(entry) {
  const images = Array.isArray(entry['im:image']) ? entry['im:image'] : [entry['im:image']].filter(Boolean);
  const poster = images.length ? upscaleArtwork(images[images.length - 1].label) : null;
  return {
    source: 'itunes',
    source_id: entry.id?.attributes?.['im:id'],
    media_type: 'movie',
    type: 'movie',
    title: entry['im:name']?.label,
    poster,
    year: (entry.releaseDate?.attributes?.label || entry.releaseDate?.label || '').slice(0, 4),
    note: null,
    genre: entry.category?.attributes?.label || null,
  };
}

export async function topMovies() {
  const resp = await fetchWithRetry(CHART_URL);
  if (!resp.ok) {
    const err = new Error(`Erreur iTunes (${resp.status})`);
    err.status = 502;
    throw err;
  }
  const data = await resp.json();
  const entries = data.feed?.entry || [];
  return entries.map(mapChartEntry).filter((m) => m.source_id);
}

// Fallback search when Cinemeta is unavailable. The iTunes Search API is keyless and returns
// French storefront titles, which is exactly what we want when Cinemeta (English-only) can't be
// reached. Apple's movie search has become unreliable in some storefronts (it can answer 0
// results for a title that is clearly in the catalogue), so an empty answer falls back to
// filtering the French top chart: a much smaller pool, but still a usable result list.
export async function searchMovies(query, { limit = 20 } = {}) {
  const term = String(query || '').trim();
  if (!term) return [];

  const url = new URL(SEARCH_URL);
  url.searchParams.set('term', term);
  url.searchParams.set('media', 'movie');
  url.searchParams.set('entity', 'movie');
  url.searchParams.set('country', 'fr');
  url.searchParams.set('lang', 'fr_fr');
  url.searchParams.set('limit', String(limit));

  const resp = await fetchWithRetry(url);
  if (!resp.ok) {
    const err = new Error(`Erreur iTunes (${resp.status})`);
    err.status = 502;
    throw err;
  }
  const data = await resp.json();
  let results = (data.results || []).map(mapSearchEntry).filter((m) => m.source_id && m.title);

  if (!results.length) {
    const needle = normalizeTitle(term);
    results = (await topMovies().catch(() => []))
      .filter((movie) => normalizeTitle(movie.title).includes(needle))
      .slice(0, limit);
  }
  return results;
}

// Cinemeta titles are English; iTunes's French storefront often has a localized title for the
// same film. Best-effort only (no result just means we keep the Cinemeta title), and only called
// when caching a detail sheet, never for a whole search result grid.
export async function findLocalizedTitle(title, { year = null } = {}) {
  if (!title) return null;
  const target = normalizeTitle(title);
  const results = await searchMovies(title, { limit: 20 });
  const exact = results.filter((movie) => normalizeTitle(movie.title) === target);
  const match = exact.find((movie) => !year || movie.year === String(year)) || exact[0];
  if (match) return match.title;

  // The French title is often a translation, not a transliteration ("The Dark Knight" vs. its
  // localized French title), so an exact title match can legitimately fail. Accept a single
  // same-year result instead; more than one stays ambiguous and keeps the Cinemeta title.
  const sameYear = results.filter((movie) => year && movie.year === String(year));
  return sameYear.length === 1 ? sameYear[0].title : null;
}

export async function getMovieDetails(sourceId) {
  const url = new URL(LOOKUP_URL);
  url.searchParams.set('id', sourceId);
  url.searchParams.set('country', 'FR');
  const resp = await fetchWithRetry(url);
  if (!resp.ok) {
    const err = new Error(`Erreur iTunes (${resp.status})`);
    err.status = 502;
    throw err;
  }
  const data = await resp.json();
  const movie = data.results?.[0];
  if (!movie) {
    const err = new Error('Film introuvable.');
    err.status = 404;
    throw err;
  }
  const poster = upscaleArtwork(movie.artworkUrl100);
  return {
    source: 'itunes',
    source_id: String(movie.trackId),
    title: movie.trackName,
    poster,
    // iTunes has no distinct wide banner image — reuse the poster as the hero backdrop.
    backdrop: poster,
    synopsis: movie.longDescription || movie.shortDescription || '',
    note: null,
    genres: movie.primaryGenreName ? [movie.primaryGenreName] : [],
    duration: movie.trackTimeMillis ? Math.round(movie.trackTimeMillis / 60000) : null,
    release_date: movie.releaseDate ? movie.releaseDate.slice(0, 10) : null,
  };
}
