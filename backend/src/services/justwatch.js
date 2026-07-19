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

// Looks up one specific title by name (not a ranking) to enrich this app's own catalog entries —
// TVmaze/Wikipedia never say *where* something streams (beyond a single platform mention buried in
// prose, if that), and neither exposes a rating. JustWatch has both: real per-platform availability
// and a rating (IMDb's, falling back to TMDB's — JustWatch aggregates several, these two are the
// ones actually populated in practice), plus its own page as a single "more info" link. Called once
// per show/movie at cache time (see catalog.js), not per page view.
export async function findByTitle(title, objectType) {
  const query = `
    query FindTitle($country: Country!, $language: Language!, $filter: TitleFilter) {
      popularTitles(country: $country, first: 1, filter: $filter) {
        edges {
          node {
            content(country: $country, language: $language) {
              fullPath
              runtime
              scoring { imdbScore tmdbScore }
            }
            offers(country: $country, platform: WEB) { monetizationType package { clearName } }
          }
        }
      }
    }
  `;
  const resp = await fetchWithRetry(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { country: 'FR', language: 'fr', filter: { objectTypes: [objectType], searchQuery: title } } }),
  });
  if (!resp.ok) throw new Error(`Erreur JustWatch (${resp.status})`);
  const { data, errors } = await resp.json();
  if (errors?.length) throw new Error(errors[0].message);

  const node = data.popularTitles.edges[0]?.node;
  if (!node) return null;
  const score = node.content.scoring?.imdbScore ?? node.content.scoring?.tmdbScore ?? null;
  return {
    platforms: extractPlatforms(node.offers),
    score: score != null ? Math.round(score * 10) / 10 : null,
    url: node.content.fullPath ? `https://www.justwatch.com${node.content.fullPath}` : null,
    runtime: node.content.runtime || null,
  };
}

// These are shown to the user as-is now (title/poster straight from JustWatch, see explore.js's
// formatJustWatchItems) rather than being resolved+filtered against TVmaze/Wikipedia first, so
// `first` only needs a small buffer over the 10 actually displayed, not the large padding a
// resolve-and-filter step used to need to still end up with 10 after some inevitably failed.
export const getPopular = (objectType, opts = {}) => fetchTitles('popularTitles', { objectType, first: 12, ...opts });
export const getNew = (objectType, opts = {}) => fetchTitles('newTitles', { objectType, first: 12, ...opts });

// JustWatch's own genre vocabulary (shortName codes), used for movie genre browsing — a curated
// subset in the order/grouping that reads naturally as a genre picker, translated to French.
export const MOVIE_GENRES = [
  { value: 'act', label: 'Action & Aventure' },
  { value: 'cmy', label: 'Comédie' },
  { value: 'drm', label: 'Drame' },
  { value: 'hrr', label: 'Horreur' },
  { value: 'rma', label: 'Comédie romantique' },
  { value: 'scf', label: 'Science-Fiction' },
  { value: 'trl', label: 'Mystère & Thriller' },
  { value: 'fnt', label: 'Fantastique' },
  { value: 'ani', label: 'Animation' },
  { value: 'crm', label: 'Crime' },
  { value: 'war', label: 'Guerre' },
  { value: 'doc', label: 'Documentaire' },
];
