const HEADERS = { 'User-Agent': 'TVTracker/1.0 (self-hosted watch tracker; no contact url)' };
const FILM_DESCRIPTION = /^(film|long[\s-]m[ée]trage)\b/i;
// Very recent pages often don't have a Wikidata short description yet (description: null),
// so also accept the "(film)" / "(film, 2026)" disambiguator commonly used in the page title itself.
const FILM_TITLE_HINT = /\(film(?:,\s*\d{4})?\)$/i;
const PERSON_DESCRIPTION = /\b(acteur|actrice|actor|actress)\b/i;

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

async function searchPages(base, query, limit = 20) {
  const url = new URL(`${base}/w/rest.php/v1/search/page`);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) {
    const err = new Error(`Erreur Wikipédia (${resp.status})`);
    err.status = 502;
    throw err;
  }
  const data = await resp.json();
  return data.pages || [];
}

async function getSummary(base, key) {
  const resp = await fetch(`${base}/api/rest_v1/page/summary/${encodeURIComponent(key)}`, { headers: HEADERS });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const err = new Error(`Erreur Wikipédia (${resp.status})`);
    err.status = 502;
    throw err;
  }
  return resp.json();
}

export async function searchMovies(query) {
  const pages = await searchPages('https://fr.wikipedia.org', query);
  return pages
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
  const data = await getSummary('https://fr.wikipedia.org', sourceId);
  if (!data) {
    const err = new Error('Film introuvable.');
    err.status = 404;
    throw err;
  }
  return {
    source: 'wikipedia',
    source_id: sourceId,
    wikibase_item: data.wikibase_item || null,
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

export async function getEnglishSummaryByTitle(title) {
  const data = await getSummary('https://en.wikipedia.org', title);
  if (!data) return null;
  return {
    poster: upscaleThumbnail(data.originalimage?.source || data.thumbnail?.source),
  };
}

export async function findWikibaseItem(title) {
  try {
    const pages = await searchPages('https://fr.wikipedia.org', title, 5);
    const match = pages.find(looksLikeFilm);
    if (!match) return null;
    const summary = await getSummary('https://fr.wikipedia.org', match.key);
    return summary?.wikibase_item || null;
  } catch {
    return null;
  }
}

export async function getPersonBio(name) {
  try {
    const pages = await searchPages('https://fr.wikipedia.org', name, 5);
    const match = pages.find((p) => PERSON_DESCRIPTION.test(p.description || '')) || pages[0];
    if (!match) return null;
    const data = await getSummary('https://fr.wikipedia.org', match.key);
    return data?.extract || null;
  } catch {
    return null;
  }
}
