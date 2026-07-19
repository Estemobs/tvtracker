import { fetchWithRetry } from './httpRetry.js';

// JustWatch has no official public API — this hits the same undocumented GraphQL endpoint their
// own website uses (no key required). It's the only keyless source that actually reflects real
// streaming-platform popularity (Netflix, Disney+, etc.), which is the whole point: it replaces
// the old "trending" that was really just "today's US TV schedule" and "most followed by our own
// tiny user base" — neither is a real trending signal. Being unofficial, it can break without
// notice; callers should treat failures as non-fatal.
const GRAPHQL_URL = 'https://apis.justwatch.com/graphql';
const IMAGE_BASE = 'https://images.justwatch.com';

function posterUrl(path) {
  if (!path) return null;
  return `${IMAGE_BASE}${path.replace('{profile}', 's332').replace('{format}', 'webp')}`;
}

// Only subscription/free offers count as "available on this platform" for a trending badge —
// rental/purchase offers exist for almost everything and would make the badge list meaningless.
function extractPlatforms(offers) {
  const seen = new Set();
  const platforms = [];
  for (const offer of offers || []) {
    if (offer.monetizationType !== 'FLATRATE' && offer.monetizationType !== 'FREE') continue;
    const name = offer.package?.clearName;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    platforms.push(name);
  }
  return platforms.slice(0, 4);
}

async function fetchTitles(root, { objectType, genres, excludeGenres, productionCountries, first }) {
  const filter = { objectTypes: [objectType] };
  if (genres) filter.genres = genres;
  if (excludeGenres) filter.excludeGenres = excludeGenres;
  if (productionCountries) filter.productionCountries = productionCountries;

  const query = `
    query GetTitles($country: Country!, $language: Language!, $first: Int!, $filter: TitleFilter) {
      titles: ${root}(country: $country, first: $first, filter: $filter) {
        edges {
          node {
            objectType
            content(country: $country, language: $language) { title posterUrl originalReleaseYear }
            offers(country: $country, platform: WEB) { monetizationType package { clearName } }
          }
        }
      }
    }
  `;
  const resp = await fetchWithRetry(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { country: 'FR', language: 'fr', first, filter } }),
  });
  if (!resp.ok) throw new Error(`Erreur JustWatch (${resp.status})`);
  const { data, errors } = await resp.json();
  if (errors?.length) throw new Error(errors[0].message);

  return data.titles.edges.map(({ node }, i) => ({
    rank: i + 1,
    title: node.content.title,
    poster: posterUrl(node.content.posterUrl),
    year: node.content.originalReleaseYear ? String(node.content.originalReleaseYear) : null,
    platforms: extractPlatforms(node.offers),
  }));
}

// `first` is padded well above 10: some titles won't resolve to this app's own catalog (fuzzy
// title-search miss) or get filtered out (e.g. a Western cartoon slipping into the anime genre
// filter) — callers trim the resolved, filtered result down to 10 themselves.
export const getPopular = (objectType, opts = {}) => fetchTitles('popularTitles', { objectType, first: 20, ...opts });
export const getNew = (objectType, opts = {}) => fetchTitles('newTitles', { objectType, first: 20, ...opts });
