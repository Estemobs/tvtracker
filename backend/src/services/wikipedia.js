import * as wikidata from './wikidata.js';
import { fetchWithRetry } from './httpRetry.js';

const HEADERS = { 'User-Agent': 'TVTracker/1.0 (self-hosted watch tracker; no contact url)' };
const FILM_DESCRIPTION = /^(film|long[\s-]m[ée]trage)\b/i;
// Very recent pages often don't have a Wikidata short description yet (description: null),
// so also accept the "(film)" / "(film, 2026)" disambiguator commonly used in the page title itself.
const FILM_TITLE_HINT = /\(film(?:,\s*\d{4})?\)$/i;
const EN_FILM_TITLE_HINT = /\(\d{4}\s*film\)$/i;
const PERSON_DESCRIPTION = /\b(acteur|actrice|actor|actress)\b/i;
const SYNOPSIS_SECTION = /^(synopsis|intrigue|r[ée]sum[ée])$/i;
const PLATFORM_PATTERN = /\b(?:diffus[ée]e?|disponible|sorti[e]?|distribu[ée]e?)\s+(?:sur|dans|via)\s+([A-Z][\w+.\s]{2,25}?)(?=[.,;]|\s+(?:et|le|en|dans|à|aux)\b|$)/;

function looksLikeFilm(page) {
  return FILM_DESCRIPTION.test(page.description || '') || FILM_TITLE_HINT.test(page.title || '');
}

// Wikipedia disambiguates article titles that clash with something else — "Matrix (film)"
// rather than just "Matrix" — but that suffix is an internal Wikipedia convention, not part of
// the movie's actual name, and looks like a bug once it reaches the UI.
function cleanTitle(title) {
  if (!title) return title;
  return title.replace(/\s*\(film(?:,\s*\d{4})?\)\s*$/i, '').trim();
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

function extractPlatform(text) {
  const match = PLATFORM_PATTERN.exec(text || '');
  return match ? match[1].trim() : null;
}

function stripArticleHtml(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\[\s*modifier\s*\|\s*modifier le code\s*\]/gi, '')
    .replace(/Cette section est vide,?\s+insuffisamment détaillée ou incomplète\.?\s+Votre aide\s+est la bienvenue\s*!?\s+Comment faire\s*\??/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function searchPages(base, query, limit = 20) {
  const url = new URL(`${base}/w/rest.php/v1/search/page`);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  const resp = await fetchWithRetry(url, { headers: HEADERS });
  if (!resp.ok) {
    const err = new Error(`Erreur Wikipédia (${resp.status})`);
    err.status = 502;
    throw err;
  }
  const data = await resp.json();
  return data.pages || [];
}

async function getSummary(base, key) {
  const resp = await fetchWithRetry(`${base}/api/rest_v1/page/summary/${encodeURIComponent(key)}`, { headers: HEADERS });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const err = new Error(`Erreur Wikipédia (${resp.status})`);
    err.status = 502;
    throw err;
  }
  return resp.json();
}

// The REST summary's "extract" is the article's lead paragraph, which on French Wikipedia film
// articles is almost always production trivia ("X est un film réalisé par Y, sorti en Z...") —
// not the plot. The actual plot lives in its own "Synopsis"/"Intrigue" section further down.
async function getSynopsisSection(base, key) {
  try {
    const sectionsUrl = new URL(`${base}/w/api.php`);
    sectionsUrl.searchParams.set('action', 'parse');
    sectionsUrl.searchParams.set('page', key);
    sectionsUrl.searchParams.set('prop', 'sections');
    sectionsUrl.searchParams.set('format', 'json');
    const sectionsResp = await fetchWithRetry(sectionsUrl, { headers: HEADERS });
    if (!sectionsResp.ok) return null;
    const sectionsData = await sectionsResp.json();
    const section = sectionsData.parse?.sections?.find((s) => SYNOPSIS_SECTION.test(s.line));
    if (!section) return null;

    const textUrl = new URL(`${base}/w/api.php`);
    textUrl.searchParams.set('action', 'parse');
    textUrl.searchParams.set('page', key);
    textUrl.searchParams.set('prop', 'text');
    textUrl.searchParams.set('section', section.index);
    textUrl.searchParams.set('format', 'json');
    const textResp = await fetchWithRetry(textUrl, { headers: HEADERS });
    if (!textResp.ok) return null;
    const textData = await textResp.json();
    const html = textData.parse?.text?.['*'];
    if (!html) return null;

    const text = stripArticleHtml(html).replace(/^(Synopsis|Intrigue|R[ée]sum[ée])\s*/i, '').trim();
    return text.length > 20 ? text : null;
  } catch {
    return null;
  }
}

// The search endpoint's own thumbnail is frequently empty for very recent films — the French
// article often has no lead image yet even though Wikidata or the English article does (that's
// exactly what the movie's own detail page already falls back to via enrichMovieWithWikidata).
// Without this, the search grid shows a blank tile for a title that turns out to have a poster
// the moment you open it.
async function resolveMissingPoster(key) {
  const summary = await getSummary('https://fr.wikipedia.org', key).catch(() => null);
  const wikibaseItem = summary?.wikibase_item;
  if (!wikibaseItem) return null;
  const wikidataPoster = await wikidata.getPoster(wikibaseItem).catch(() => null);
  if (wikidataPoster) return wikidataPoster;
  const enTitle = await wikidata.getEnglishSitelink(wikibaseItem).catch(() => null);
  if (!enTitle) return null;
  const en = await getEnglishSummaryByTitle(enTitle).catch(() => null);
  return en?.poster || null;
}

export async function searchMovies(query) {
  const pages = await searchPages('https://fr.wikipedia.org', query);
  const films = pages.filter(looksLikeFilm);
  return Promise.all(films.map(async (p) => {
    let poster = upscaleThumbnail(p.thumbnail?.url);
    if (!poster) poster = await resolveMissingPoster(p.key).catch(() => null);
    return {
      source: 'wikipedia',
      source_id: p.key,
      media_type: 'movie',
      type: 'movie',
      title: cleanTitle(p.title),
      poster,
      year: extractYear(p.description, p.title),
      note: null,
    };
  }));
}

export async function getMovieSummary(sourceId) {
  const data = await getSummary('https://fr.wikipedia.org', sourceId);
  if (!data) {
    const err = new Error('Film introuvable.');
    err.status = 404;
    throw err;
  }
  const plot = await getSynopsisSection('https://fr.wikipedia.org', sourceId);
  // Wikipedia doesn't expose a distinct wide banner image — reuse the poster as the detail
  // page's hero backdrop rather than leaving it permanently blank.
  const poster = upscaleThumbnail(data.thumbnail?.source || data.originalimage?.source);
  return {
    source: 'wikipedia',
    source_id: sourceId,
    wikibase_item: data.wikibase_item || null,
    title: cleanTitle(data.title),
    poster,
    backdrop: poster,
    synopsis: plot || data.extract || '',
    platform: extractPlatform(data.extract),
    note: null,
    genres: [],
    duration: null,
    release_date: extractYear(data.description, data.title) || null,
  };
}

// French Wikipedia search already resolves most English-titled queries via redirects — a famous
// title like "Titanic" or "Forrest Gump" typically only ever returns 1-2 results there (the
// search API is precise, not fuzzy), and that's already the correct film. The English fallback
// chain is expensive (many extra requests per candidate: an English summary, a Wikidata sitelink
// lookup, a French summary, ...), so it used to trigger on anything under 3 results — which was
// nearly always, turning almost every bulk-import title into 15-20 extra external calls and
// reliably tripping Wikipedia's rate limiter over a large import. Only fall back when French
// search found nothing at all worth calling a film.
export async function searchMoviesAnyLanguage(query) {
  const primary = await searchMovies(query);
  if (primary.length > 0) return primary;
  const englishMatches = await searchMoviesEnglishFallback(query).catch(() => []);
  const seen = new Set(primary.map((m) => m.source_id));
  return [...primary, ...englishMatches.filter((m) => !seen.has(m.source_id))];
}

export async function getEnglishSummaryByTitle(title) {
  const data = await getSummary('https://en.wikipedia.org', title);
  if (!data) return null;
  return {
    poster: upscaleThumbnail(data.thumbnail?.source || data.originalimage?.source),
  };
}

// Used when a movie's primary source (iTunes) isn't Wikipedia itself, to cross-reference a
// matching French article for its Wikidata item and, as a bonus already-fetched-for-free,
// its platform mention (iTunes never tells us where a title streams; Wikipedia's lead often does).
export async function findFrenchArticle(title) {
  try {
    const pages = await searchPages('https://fr.wikipedia.org', title, 5);
    const match = pages.find(looksLikeFilm);
    if (!match) return null;
    const summary = await getSummary('https://fr.wikipedia.org', match.key);
    if (!summary?.wikibase_item) return null;
    return { wikibase_item: summary.wikibase_item, platform: extractPlatform(summary.extract) };
  } catch {
    return null;
  }
}

// Fallback for English-titled searches: French Wikipedia's own search usually resolves these
// via redirects, but when it comes up empty (obscure titles, or ones lacking a redirect yet),
// look on English Wikipedia and — only when a French version of that exact article exists via
// its Wikidata sitelink, never a fuzzy title guess — surface the French page instead, so the
// rest of the app (source='wikipedia' always meaning fr.wikipedia.org) doesn't need to change.
export async function searchMoviesEnglishFallback(query) {
  const pages = await searchPages('https://en.wikipedia.org', query, 10);
  const matches = pages.filter((p) => EN_FILM_TITLE_HINT.test(p.title || '') || FILM_DESCRIPTION.test(p.description || ''));

  const resolved = await Promise.all(matches.slice(0, 5).map(async (page) => {
    try {
      const enSummary = await getSummary('https://en.wikipedia.org', page.key);
      const wikibaseItem = enSummary?.wikibase_item;
      if (!wikibaseItem) return null;
      const frTitle = await wikidata.getFrenchSitelink(wikibaseItem);
      if (!frTitle) return null;
      const frKey = frTitle.replace(/ /g, '_');
      const frData = await getSummary('https://fr.wikipedia.org', frKey);
      if (!frData) return null;
      // French article often lacks its own lead image even once resolved this way — the English
      // article we already fetched, or Wikidata's own P18 claim, frequently has one.
      let poster = upscaleThumbnail(frData.thumbnail?.source || frData.originalimage?.source);
      if (!poster) poster = await wikidata.getPoster(wikibaseItem).catch(() => null);
      if (!poster) poster = upscaleThumbnail(enSummary.thumbnail?.source || enSummary.originalimage?.source);
      return {
        source: 'wikipedia',
        source_id: frKey,
        media_type: 'movie',
        type: 'movie',
        title: cleanTitle(frData.title),
        poster,
        year: extractYear(frData.description, frData.title),
        note: null,
      };
    } catch {
      return null;
    }
  }));

  // Different English pages (a redirect and its target, a disambiguated title, etc.) can resolve
  // to the very same French article via Wikidata — dedupe by source_id before returning.
  const seen = new Set();
  return resolved.filter((m) => {
    if (!m || seen.has(m.source_id)) return false;
    seen.add(m.source_id);
    return true;
  });
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
