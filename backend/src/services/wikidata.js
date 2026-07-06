const HEADERS = { 'User-Agent': 'TVTracker/1.0 (self-hosted watch tracker; no contact url)' };
const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const API_ENDPOINT = 'https://www.wikidata.org/w/api.php';

function commonsFileUrl(filename) {
  if (!filename) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename.replace(/ /g, '_'))}`;
}

export async function getCastAndRating(wikibaseItem) {
  if (!wikibaseItem) return { cast: [], rating: null };

  const query = `
    SELECT ?actorLabel ?characterLabel ?score ?sourceLabel WHERE {
      OPTIONAL {
        wd:${wikibaseItem} p:P161 ?castStatement.
        ?castStatement ps:P161 ?actor.
        OPTIONAL { ?castStatement pq:P453 ?character. }
      }
      OPTIONAL {
        wd:${wikibaseItem} p:P444 ?scoreStatement.
        ?scoreStatement ps:P444 ?score.
        OPTIONAL { ?scoreStatement pq:P447 ?source. }
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
    } LIMIT 60
  `;

  const url = new URL(SPARQL_ENDPOINT);
  url.searchParams.set('query', query);
  const resp = await fetch(url, { headers: { ...HEADERS, Accept: 'application/sparql-results+json' } });
  if (!resp.ok) return { cast: [], rating: null };

  const data = await resp.json();
  const cast = [];
  const seenActors = new Set();
  let imdbRating = null;

  for (const row of data.results.bindings) {
    if (row.actorLabel && !/^Q\d+$/.test(row.actorLabel.value) && !seenActors.has(row.actorLabel.value)) {
      seenActors.add(row.actorLabel.value);
      cast.push({ actor: row.actorLabel.value, character: row.characterLabel?.value || null });
    }
    // Wikidata mixes review scores from different scales (IMDb "8.8/10", Rotten Tomatoes "81%"
    // or "7.4/10", Metacritic "67/100"...). Only IMDb matches our existing 0-10 "note"
    // semantics, so that's the only source surfaced here to avoid showing e.g. "⭐ 81".
    if (!imdbRating && row.score && /internet movie database|imdb/i.test(row.sourceLabel?.value || '')) {
      const match = /^(\d+(?:\.\d+)?)\s*\/\s*10$/.exec(row.score.value.trim());
      if (match) imdbRating = Number(match[1]);
    }
  }

  return { cast: cast.slice(0, 20), rating: imdbRating };
}

export async function getPoster(wikibaseItem) {
  if (!wikibaseItem) return null;
  const url = new URL(API_ENDPOINT);
  url.searchParams.set('action', 'wbgetclaims');
  url.searchParams.set('entity', wikibaseItem);
  url.searchParams.set('property', 'P18');
  url.searchParams.set('format', 'json');
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) return null;
  const data = await resp.json();
  const filename = data.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return commonsFileUrl(filename);
}

export async function getEnglishSitelink(wikibaseItem) {
  if (!wikibaseItem) return null;
  const url = new URL(API_ENDPOINT);
  url.searchParams.set('action', 'wbgetentities');
  url.searchParams.set('ids', wikibaseItem);
  url.searchParams.set('props', 'sitelinks');
  url.searchParams.set('sitefilter', 'enwiki');
  url.searchParams.set('format', 'json');
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.entities?.[wikibaseItem]?.sitelinks?.enwiki?.title || null;
}
