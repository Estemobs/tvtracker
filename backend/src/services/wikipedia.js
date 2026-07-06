const API_BASE = 'https://fr.wikipedia.org';
const HEADERS = { 'User-Agent': 'TVTracker/1.0 (self-hosted watch tracker; no contact url)' };
const FILM_DESCRIPTION = /^(film|long[\s-]m[ée]trage)\b/i;
// Very recent pages often don't have a Wikidata short description yet (description: null),
// so also accept the "(film)" / "(film, 2026)" disambiguator commonly used in the page title itself.
const FILM_TITLE_HINT = /\(film(?:,\s*\d{4})?\)$/i;

function looksLikeFilm(page) {
  return FILM_DESCRIPTION.test(page.description || '') || FILM_TITLE_HINT.test(page.title || '');
}

function upscaleThumbnail(url, width = 500) {
  if (!url) return null;
  const full = url.startsWith('//') ? `https:${url}` : url;
  return full.replace(/\/\d+px-/, `/${width}px-`);
}

function extractYear(description, title) {
  const match = /(\d{4})/.exec(description || '') || /(\d{4})/.exec(title || '');
  return match ? match[1] : '';
}

export async function searchMovies(query) {
  const url = new URL(`${API_BASE}/w/rest.php/v1/search/page`);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '20');
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) {
    const err = new Error(`Erreur Wikipédia (${resp.status})`);
    err.status = 502;
    throw err;
  }
  const data = await resp.json();
  return (data.pages || [])
    .filter(looksLikeFilm)
    .map((p) => ({
      source: 'wikipedia',
      source_id: p.key,
      media_type: 'movie',
      type: 'movie',
      title: p.title,
      poster: upscaleThumbnail(p.thumbnail?.url),
      year: extractYear(p.description, p.title),
      note: null,
    }));
}

export async function getMovieSummary(sourceId) {
  const resp = await fetch(`${API_BASE}/api/rest_v1/page/summary/${encodeURIComponent(sourceId)}`, { headers: HEADERS });
  if (resp.status === 404) {
    const err = new Error('Film introuvable.');
    err.status = 404;
    throw err;
  }
  if (!resp.ok) {
    const err = new Error(`Erreur Wikipédia (${resp.status})`);
    err.status = 502;
    throw err;
  }
  const data = await resp.json();
  return {
    source: 'wikipedia',
    source_id: sourceId,
    title: data.title,
    poster: upscaleThumbnail(data.originalimage?.source || data.thumbnail?.source),
    backdrop: null,
    synopsis: data.extract || '',
    note: null,
    genres: [],
    duration: null,
    release_date: extractYear(data.description, data.title) || null,
  };
}
