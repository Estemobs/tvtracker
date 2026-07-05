const API_BASE = 'https://api.tvmaze.com';

export const GENRES = [
  'Action', 'Adventure', 'Anime', 'Anthology', 'Comedy', 'Crime', 'Drama',
  'Espionage', 'Family', 'Fantasy', 'Food', 'History', 'Horror', 'Legal',
  'Medical', 'Music', 'Mystery', 'Nature', 'Romance', 'Science-Fiction',
  'Sports', 'Supernatural', 'Thriller', 'Travel', 'War', 'Western',
];

function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function tvmazeFetch(pathname) {
  const resp = await fetch(API_BASE + pathname);
  if (resp.status === 404) {
    const err = new Error('Contenu introuvable.');
    err.status = 404;
    throw err;
  }
  if (!resp.ok) {
    const err = new Error(`Erreur TVmaze (${resp.status})`);
    err.status = 502;
    throw err;
  }
  return resp.json();
}

function isAnime(show) {
  return (show.genres || []).includes('Anime');
}

function mapShow(show) {
  return {
    source: 'tvmaze',
    source_id: String(show.id),
    media_type: 'tv',
    type: isAnime(show) ? 'anime' : 'serie',
    title: show.name,
    poster: show.image?.original || show.image?.medium || null,
    year: (show.premiered || '').slice(0, 4),
    note: show.rating?.average ?? null,
  };
}

export async function searchShows(query) {
  const data = await tvmazeFetch(`/search/shows?q=${encodeURIComponent(query)}`);
  return data.map((r) => mapShow(r.show));
}

export async function scheduleHighlights() {
  const data = await tvmazeFetch('/schedule?country=US');
  const seen = new Set();
  const shows = [];
  for (const entry of data) {
    if (!entry.show || seen.has(entry.show.id)) continue;
    seen.add(entry.show.id);
    shows.push(mapShow(entry.show));
  }
  return shows.sort((a, b) => (b.note || 0) - (a.note || 0));
}

export async function discoverByGenre(genre, page = 0) {
  const data = await tvmazeFetch(`/shows?page=${page}`);
  return data
    .filter((show) => !genre || (show.genres || []).includes(genre))
    .sort((a, b) => (b.rating?.average || 0) - (a.rating?.average || 0))
    .slice(0, 30)
    .map(mapShow);
}

export async function getShowDetails(sourceId) {
  const show = await tvmazeFetch(`/shows/${sourceId}`);
  const episodes = await tvmazeFetch(`/shows/${sourceId}/episodes`);
  const seasons = [...new Set(episodes.map((e) => e.season))].sort((a, b) => a - b);
  return {
    source: 'tvmaze',
    source_id: String(show.id),
    type: isAnime(show) ? 'anime' : 'serie',
    title: show.name,
    poster: show.image?.original || show.image?.medium || null,
    backdrop: null,
    synopsis: stripHtml(show.summary),
    note: show.rating?.average ?? null,
    genres: show.genres || [],
    air_status: show.status,
    nb_seasons: seasons.length,
    nb_episodes: episodes.length,
    episodes: episodes.map((e) => ({
      season: e.season,
      episode_number: e.number,
      title: e.name,
      duration: e.runtime,
      air_date: e.airdate,
    })),
  };
}
