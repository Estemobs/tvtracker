import { log as debugLog } from './debugLog.js';

// Cinemeta is the unofficial metadata add-on Stremio itself uses. It has no API key and no
// documented contract, but it exposes exactly what this app needs for movies: an IMDb-backed
// search and a detail sheet (poster, backdrop, synopsis, runtime, rating, genres, cast).
//
// It is deliberately isolated behind this module: catalog.js only ever sees the same shape the
// rest of the app already consumes (`source`, `source_id`, `title`, `poster`, `duration`, ...),
// so swapping providers never leaks into routes or the frontend.
const BASE_URL = 'https://v3-cinemeta.strem.io';
const TIMEOUT_MS = 4000;
const HEADERS = { 'User-Agent': 'TVTracker/1.0 (self-hosted watch tracker; no contact url)' };

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function fetchJson(url, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const resp = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!resp.ok) {
      throw httpError(`Erreur Cinemeta (${resp.status}) lors de la ${label}.`, resp.status === 404 ? 404 : 502);
    }
    const data = await resp.json();
    debugLog('http', `GET ${url} -> ${resp.status} en ${Date.now() - startedAt}ms`);
    return data;
  } catch (error) {
    if (error.status) throw error;
    if (error.name === 'AbortError') {
      throw httpError(`Cinemeta n'a pas répondu en ${TIMEOUT_MS / 1000} s (${label}).`, 504);
    }
    throw httpError(`Cinemeta est injoignable (${label}) : ${error.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

function parseYear(value) {
  const match = /(\d{4})/.exec(String(value || ''));
  return match ? match[1] : '';
}

// Cinemeta reports runtime either as a plain number, "148 min", or occasionally "2h 28m".
function parseRuntime(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  const text = String(value);
  const hours = /(\d+)\s*h(?:eures?|ours?)?/i.exec(text);
  const minutes = /(\d+)\s*m(?:in(?:utes?)?)?/i.exec(text);
  if (hours || minutes) {
    return (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
  }
  const plain = /^(\d+)$/.exec(text.trim());
  return plain ? Number(plain[1]) : null;
}

function parseRating(value) {
  const rating = Number.parseFloat(value);
  return Number.isFinite(rating) ? rating : null;
}

// The metahub CDN serves the same title in several sizes: /small/ is 250px and visibly blurry
// in a poster grid, /medium/ is a decent webp, /large/ is often a several-hundred-KB JPEG.
function upscalePoster(url) {
  return url ? url.replace('/poster/small/', '/poster/medium/') : null;
}

function imdbIdOf(raw) {
  if (/^tt\d+$/.test(raw.imdb_id || '')) return raw.imdb_id;
  // Search entries sometimes only carry `id`, but when it looks like an IMDb id it is one.
  return /^tt\d+$/.test(raw.id || '') ? raw.id : null;
}

// One mapper for both endpoints. Search entries and detail sheets use different field names
// (`genre` vs `genres`, `released` vs `releaseInfo`, optional cast/description/rating), so every
// field is read defensively instead of assuming one endpoint's exact shape.
export function mapMovie(raw = {}) {
  const imdbId = imdbIdOf(raw);
  const genres = Array.isArray(raw.genres)
    ? raw.genres
    : Array.isArray(raw.genre) ? raw.genre : [];
  const cast = Array.isArray(raw.cast)
    ? raw.cast
      .filter(Boolean)
      .map((actor) => ({ person_id: null, actor, character: null, photo: null }))
    : [];

  return {
    source: 'cinemeta',
    source_id: imdbId,
    imdb_id: imdbId,
    media_type: 'movie',
    type: 'movie',
    title: raw.name || '',
    poster: upscalePoster(raw.poster),
    backdrop: raw.background || null,
    synopsis: raw.description || '',
    note: parseRating(raw.imdbRating),
    genres,
    duration: parseRuntime(raw.runtime),
    release_date: raw.released ? String(raw.released).slice(0, 10) : (parseYear(raw.releaseInfo || raw.year) || null),
    year: parseYear(raw.releaseInfo || raw.year || raw.released),
    cast,
    platform: null,
  };
}

export async function searchMovies(query) {
  const term = String(query || '').trim();
  if (!term) return [];
  const url = `${BASE_URL}/catalog/movie/top/search=${encodeURIComponent(term)}.json`;
  const data = await fetchJson(url, 'recherche');
  const seen = new Set();
  return (Array.isArray(data.metas) ? data.metas : [])
    .map(mapMovie)
    .filter((movie) => {
      if (!movie.source_id || !movie.title || seen.has(movie.source_id)) return false;
      seen.add(movie.source_id);
      return true;
    });
}

export async function getMovie(imdbId) {
  const id = String(imdbId || '').trim();
  if (!/^tt\d+$/.test(id)) throw httpError('Identifiant IMDb invalide.', 400);
  const data = await fetchJson(`${BASE_URL}/meta/movie/${encodeURIComponent(id)}.json`, 'fiche');
  if (!data.meta) throw httpError('Film introuvable.', 404);
  const movie = mapMovie(data.meta);
  if (!movie.source_id) movie.source_id = id;
  if (!movie.imdb_id) movie.imdb_id = id;
  return movie;
}
