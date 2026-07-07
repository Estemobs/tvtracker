import { fetchWithRetry } from './httpRetry.js';

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
  const resp = await fetchWithRetry(API_BASE + pathname);
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

// TV Time (and most other trackers) key shows by TheTVDB id — TVmaze's lookup endpoint
// resolves that directly, no fuzzy title search needed for imported data.
export async function findByTvdbId(tvdbId) {
  try {
    const show = await tvmazeFetch(`/lookup/shows?thetvdb=${tvdbId}`);
    return show ? String(show.id) : null;
  } catch {
    return null;
  }
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
  const shows = data.map((r) => mapShow(r.show));
  // /search/shows doesn't support ?embed, so season counts need one lightweight call per result.
  const withSeasons = await Promise.all(shows.map(async (show) => {
    try {
      const seasons = await tvmazeFetch(`/shows/${show.source_id}/seasons`);
      return { ...show, nb_seasons: seasons.length };
    } catch {
      return show;
    }
  }));
  return withSeasons;
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

  let nextEpisode = null;
  const nextHref = show._links?.nextepisode?.href;
  if (nextHref) {
    const episodeId = nextHref.split('/').pop();
    const ep = await tvmazeFetch(`/episodes/${episodeId}`).catch(() => null);
    if (ep) nextEpisode = { season: ep.season, episode_number: ep.number, air_date: ep.airdate };
  }

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
    platform: show.webChannel?.name || show.network?.name || null,
    schedule_day: show.schedule?.days?.[0] || null,
    schedule_time: show.schedule?.time || null,
    runtime: show.averageRuntime ?? show.runtime ?? null,
    next_episode: nextEpisode,
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

export async function getCast(sourceId) {
  const data = await tvmazeFetch(`/shows/${sourceId}/cast`);
  return data
    .filter((c) => c.person && c.character)
    .map((c) => ({
      person_id: c.person.id,
      actor: c.person.name,
      character: c.character.name,
      photo: c.person.image?.medium || null,
    }));
}

export async function getPerson(personId) {
  const person = await tvmazeFetch(`/people/${personId}`);
  return {
    person_id: person.id,
    name: person.name,
    photo: person.image?.original || person.image?.medium || null,
    country: person.country?.name || null,
    birthday: person.birthday || null,
  };
}

export async function getPersonFilmography(personId) {
  const data = await tvmazeFetch(`/people/${personId}/castcredits?embed=show`);
  const seen = new Set();
  const credits = [];
  for (const credit of data) {
    const show = credit._embedded?.show;
    if (!show || seen.has(show.id)) continue;
    seen.add(show.id);
    credits.push({
      source_id: String(show.id),
      title: show.name,
      poster: show.image?.medium || show.image?.original || null,
      character: credit._links?.character?.name || null,
      year: (show.premiered || '').slice(0, 4),
    });
  }
  return credits.sort((a, b) => (b.year || '').localeCompare(a.year || ''));
}
