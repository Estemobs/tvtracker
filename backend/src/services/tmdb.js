const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p';

function apiKeyParam() {
  const key = process.env.TMDB_API_KEY;
  if (!key) {
    const err = new Error('TMDB_API_KEY manquant côté serveur.');
    err.status = 503;
    throw err;
  }
  return key;
}

async function tmdbFetch(pathname, params = {}) {
  const url = new URL(TMDB_API_BASE + pathname);
  url.searchParams.set('api_key', apiKeyParam());
  url.searchParams.set('language', 'fr-FR');
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const resp = await fetch(url);
  if (!resp.ok) {
    const err = new Error(`Erreur TMDB (${resp.status})`);
    err.status = resp.status === 404 ? 404 : 502;
    throw err;
  }
  return resp.json();
}

export function posterUrl(path, size = 'w500') {
  return path ? `${IMG_BASE}/${size}${path}` : null;
}

function isAnime(item, mediaType) {
  const genreIds = item.genre_ids || (item.genres || []).map((g) => g.id);
  return mediaType === 'tv' && genreIds?.includes(16) && item.original_language === 'ja';
}

function mapSearchResult(item) {
  const mediaType = item.media_type || (item.title ? 'movie' : 'tv');
  if (mediaType === 'person') return null;
  return {
    tmdb_id: item.id,
    media_type: mediaType,
    type: isAnime(item, mediaType) ? 'anime' : 'serie',
    title: item.title || item.name,
    poster: posterUrl(item.poster_path),
    year: (item.release_date || item.first_air_date || '').slice(0, 4),
    note: item.vote_average,
  };
}

export async function searchMulti(query, page = 1) {
  const data = await tmdbFetch('/search/multi', { query, page, include_adult: false });
  return {
    page: data.page,
    total_pages: data.total_pages,
    results: data.results.map(mapSearchResult).filter(Boolean),
  };
}

export async function discover(mediaType, { genre, sort = 'popularity.desc', page = 1 } = {}) {
  const data = await tmdbFetch(`/discover/${mediaType}`, { with_genres: genre, sort_by: sort, page });
  return {
    page: data.page,
    total_pages: data.total_pages,
    results: data.results.map((r) => mapSearchResult({ ...r, media_type: mediaType })).filter(Boolean),
  };
}

export async function trending(mediaType = 'all', window = 'week') {
  const data = await tmdbFetch(`/trending/${mediaType}/${window}`);
  return data.results.map(mapSearchResult).filter(Boolean);
}

export async function genreList(mediaType) {
  const data = await tmdbFetch(`/genre/${mediaType}/list`);
  return data.genres;
}

export async function getTvDetails(tmdbId) {
  const data = await tmdbFetch(`/tv/${tmdbId}`);
  return {
    tmdb_id: data.id,
    type: isAnime(data, 'tv') ? 'anime' : 'serie',
    title: data.name,
    poster: posterUrl(data.poster_path),
    backdrop: posterUrl(data.backdrop_path, 'w1280'),
    synopsis: data.overview,
    note: data.vote_average,
    genres: (data.genres || []).map((g) => g.name),
    air_status: data.status,
    nb_seasons: data.number_of_seasons,
    nb_episodes: data.number_of_episodes,
    seasons: (data.seasons || []).filter((s) => s.season_number > 0),
  };
}

export async function getSeasonDetails(tmdbId, seasonNumber) {
  const data = await tmdbFetch(`/tv/${tmdbId}/season/${seasonNumber}`);
  return {
    season: data.season_number,
    episodes: (data.episodes || []).map((e) => ({
      episode_number: e.episode_number,
      title: e.name,
      duration: e.runtime,
      air_date: e.air_date,
    })),
  };
}

export async function getMovieDetails(tmdbId) {
  const data = await tmdbFetch(`/movie/${tmdbId}`);
  return {
    tmdb_id: data.id,
    title: data.title,
    poster: posterUrl(data.poster_path),
    backdrop: posterUrl(data.backdrop_path, 'w1280'),
    synopsis: data.overview,
    note: data.vote_average,
    genres: (data.genres || []).map((g) => g.name),
    duration: data.runtime,
    release_date: data.release_date,
  };
}
