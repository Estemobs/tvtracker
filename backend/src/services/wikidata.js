import { fetchWithRetry } from './httpRetry.js';

const HEADERS = { 'User-Agent': 'TVTracker/1.0 (self-hosted watch tracker; no contact url)' };
const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const API_ENDPOINT = 'https://www.wikidata.org/w/api.php';

function commonsFileUrl(filename) {
  if (!filename) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename.replace(/ /g, '_'))}`;
}

function normalizeScore(rawValue, sourceLabel) {
  const value = (rawValue || '').trim();
  const tenScale = /^(\d+(?:\.\d+)?)\s*\/\s*10$/.exec(value);
  if (tenScale) return Number(tenScale[1]);
  const hundredScale = /^(\d+(?:\.\d+)?)\s*\/\s*100$/.exec(value);
  if (hundredScale) return Math.round((Number(hundredScale[1]) / 10) * 10) / 10;
  const percent = /^(\d+(?:\.\d+)?)\s*%$/.exec(value);
  // A raw percentage is ambiguous between "Tomatometer" (% of positive reviews, not a quality
  // average) and an actual average score — only trust it when the source itself isn't Rotten
  // Tomatoes, since RT's own /10 "audience/critic average" statement is what we want instead.
  if (percent && !/rotten tomatoes/i.test(sourceLabel || '')) {
    return Math.round((Number(percent[1]) / 10) * 10) / 10;
  }
  return null;
}

export async function getCastAndRating(wikibaseItem) {
  if (!wikibaseItem) return { cast: [], rating: null };

  const query = `
    SELECT ?actor ?actorLabel ?characterLabel ?actorImage ?score ?sourceLabel WHERE {
      OPTIONAL {
        wd:${wikibaseItem} p:P161 ?castStatement.
        ?castStatement ps:P161 ?actor.
        OPTIONAL { ?castStatement pq:P453 ?character. }
        OPTIONAL { ?actor wdt:P18 ?actorImage. }
      }
      OPTIONAL {
        wd:${wikibaseItem} p:P444 ?scoreStatement.
        ?scoreStatement ps:P444 ?score.
        OPTIONAL { ?scoreStatement pq:P447 ?source. }
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
    } LIMIT 80
  `;

  const url = new URL(SPARQL_ENDPOINT);
  url.searchParams.set('query', query);
  const resp = await fetchWithRetry(url, { headers: { ...HEADERS, Accept: 'application/sparql-results+json' } });
  if (!resp.ok) return { cast: [], rating: null };

  const data = await resp.json();
  const cast = [];
  const seenActors = new Set();
  // Prefer whichever review source appears first among these, in this order, over the others.
  const ratingsBySource = {};

  for (const row of data.results.bindings) {
    if (row.actorLabel && !/^Q\d+$/.test(row.actorLabel.value) && !seenActors.has(row.actorLabel.value)) {
      seenActors.add(row.actorLabel.value);
      // wdt:P18 inside SPARQL already resolves to a full, ready-to-use Commons file URL
      // (unlike the wbgetclaims REST calls elsewhere, which return a bare filename) — use it
      // as-is; re-running it through commonsFileUrl would double percent-encode it.
      cast.push({
        person_id: row.actor?.value?.split('/').pop() || null,
        actor: row.actorLabel.value,
        character: row.characterLabel?.value || null,
        photo: row.actorImage?.value?.replace(/^http:/, 'https:') || null,
      });
    }
    if (row.score) {
      const source = row.sourceLabel?.value || 'inconnue';
      if (!(source in ratingsBySource)) {
        const value = normalizeScore(row.score.value, source);
        if (value !== null) ratingsBySource[source] = value;
      }
    }
  }

  let rating = null;
  for (const preferred of ['Internet Movie Database', 'Metacritic', 'Rotten Tomatoes']) {
    const match = Object.keys(ratingsBySource).find((s) => new RegExp(preferred, 'i').test(s));
    if (match) { rating = { value: ratingsBySource[match], source: match }; break; }
  }
  if (!rating) {
    const anySource = Object.keys(ratingsBySource)[0];
    if (anySource) rating = { value: ratingsBySource[anySource], source: anySource };
  }

  return { cast: cast.slice(0, 20), rating };
}

export async function getPoster(wikibaseItem) {
  if (!wikibaseItem) return null;
  const url = new URL(API_ENDPOINT);
  url.searchParams.set('action', 'wbgetclaims');
  url.searchParams.set('entity', wikibaseItem);
  url.searchParams.set('property', 'P18');
  url.searchParams.set('format', 'json');
  const resp = await fetchWithRetry(url, { headers: HEADERS });
  if (!resp.ok) return null;
  const data = await resp.json();
  const filename = data.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return commonsFileUrl(filename);
}

async function getSitelink(wikibaseItem, site) {
  if (!wikibaseItem) return null;
  const url = new URL(API_ENDPOINT);
  url.searchParams.set('action', 'wbgetentities');
  url.searchParams.set('ids', wikibaseItem);
  url.searchParams.set('props', 'sitelinks');
  url.searchParams.set('sitefilter', site);
  url.searchParams.set('format', 'json');
  const resp = await fetchWithRetry(url, { headers: HEADERS });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.entities?.[wikibaseItem]?.sitelinks?.[site]?.title || null;
}

export const getEnglishSitelink = (wikibaseItem) => getSitelink(wikibaseItem, 'enwiki');
export const getFrenchSitelink = (wikibaseItem) => getSitelink(wikibaseItem, 'frwiki');

// "followed by" (P156) points to the next film in a franchise/saga — with its own release date
// (P577) this doubles as an upcoming-sequel preview, even for an unreleased future film.
export async function getNextInstallment(wikibaseItem) {
  if (!wikibaseItem) return null;
  const query = `
    SELECT ?nextLabel ?date WHERE {
      wd:${wikibaseItem} wdt:P156 ?next.
      OPTIONAL { ?next wdt:P577 ?date. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
    } LIMIT 5
  `;
  const url = new URL(SPARQL_ENDPOINT);
  url.searchParams.set('query', query);
  const resp = await fetchWithRetry(url, { headers: { ...HEADERS, Accept: 'application/sparql-results+json' } });
  if (!resp.ok) return null;
  const data = await resp.json();
  const row = data.results.bindings.find((r) => r.nextLabel && !/^Q\d+$/.test(r.nextLabel.value));
  if (!row) return null;
  return { title: row.nextLabel.value, release_date: row.date?.value?.slice(0, 10) || null };
}

export async function getPerson(personId) {
  const url = new URL(API_ENDPOINT);
  url.searchParams.set('action', 'wbgetentities');
  url.searchParams.set('ids', personId);
  url.searchParams.set('props', 'labels|claims');
  url.searchParams.set('languages', 'fr|en');
  url.searchParams.set('format', 'json');
  const resp = await fetchWithRetry(url, { headers: HEADERS });
  if (!resp.ok) return null;
  const data = await resp.json();
  const entity = data.entities?.[personId];
  if (!entity) return null;
  const claims = entity.claims || {};
  const filename = claims.P18?.[0]?.mainsnak?.datavalue?.value;
  const birthday = claims.P569?.[0]?.mainsnak?.datavalue?.value?.time?.slice(1, 11) || null;
  return {
    person_id: personId,
    name: entity.labels?.fr?.value || entity.labels?.en?.value || personId,
    photo: commonsFileUrl(filename),
    birthday,
    country: null,
  };
}

// Reverse lookup of "cast member" (P161): every other film where this same person appears,
// used as a movie actor's filmography — the equivalent of TVmaze's castcredits for TV actors.
export async function getPersonFilmography(personId) {
  const query = `
    SELECT ?filmLabel ?film ?date WHERE {
      ?film wdt:P161 wd:${personId}.
      OPTIONAL { ?film wdt:P577 ?date. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
    } LIMIT 30
  `;
  const url = new URL(SPARQL_ENDPOINT);
  url.searchParams.set('query', query);
  const resp = await fetchWithRetry(url, { headers: { ...HEADERS, Accept: 'application/sparql-results+json' } });
  if (!resp.ok) return [];
  const data = await resp.json();
  const seenFilms = new Set();
  const films = [];
  // A film with several P577 statements (festival premiere, regional release dates...)
  // otherwise produces one duplicate row per date — keep only the first one seen per film.
  for (const r of data.results.bindings) {
    if (!r.filmLabel || /^Q\d+$/.test(r.filmLabel.value)) continue;
    const wikibaseItem = r.film.value.split('/').pop();
    if (seenFilms.has(wikibaseItem)) continue;
    seenFilms.add(wikibaseItem);
    films.push({ wikibase_item: wikibaseItem, title: r.filmLabel.value, year: r.date?.value?.slice(0, 4) || null });
  }
  return films.sort((a, b) => (b.year || '').localeCompare(a.year || ''));
}
