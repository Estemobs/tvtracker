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
  const plot = await getSynopsisSection('https://fr.wikipedia.org', sourceId);
  return {
    source: 'wikipedia',
    source_id: sourceId,
    wikibase_item: data.wikibase_item || null,
    title: data.title,
    poster: upscaleThumbnail(data.originalimage?.source || data.thumbnail?.source),
    backdrop: null,
    synopsis: plot || data.extract || '',
    platform: extractPlatform(data.extract),
    note: null,
    genres: [],
    duration: null,
    release_date: extractYear(data.description, data.title) || null,
  };
}

// French Wikipedia search already resolves most English-titled queries via redirects; only
// when it comes up thin do we also check English Wikipedia (mapped back to French — see
// searchMoviesEnglishFallback for why never a fuzzy match).
export async function searchMoviesAnyLanguage(query) {
  const primary = await searchMovies(query);
  if (primary.length >= 3) return primary;
  const englishMatches = await searchMoviesEnglishFallback(query).catch(() => []);
  const seen = new Set(primary.map((m) => m.source_id));
  return [...primary, ...englishMatches.filter((m) => !seen.has(m.source_id))];
}

export async function getEnglishSummaryByTitle(title) {
  const data = await getSummary('https://en.wikipedia.org', title);
  if (!data) return null;
  return {
    poster: upscaleThumbnail(data.originalimage?.source || data.thumbnail?.source),
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
      return {
        source: 'wikipedia',
        source_id: frKey,
        media_type: 'movie',
        type: 'movie',
        title: frData.title,
        poster: upscaleThumbnail(frData.originalimage?.source || frData.thumbnail?.source),
        year: extractYear(frData.description, frData.title),
        note: null,
      };
    } catch {
      return null;
    }
  }));

  return resolved.filter(Boolean);
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
