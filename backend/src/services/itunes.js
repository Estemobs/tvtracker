const LOOKUP_URL = 'https://itunes.apple.com/lookup';
const CHART_URL = 'https://itunes.apple.com/fr/rss/topmovies/limit=40/json';

function upscaleArtwork(url) {
  return url ? url.replace(/\d+x\d+bb\.(jpg|png)$/, '600x600bb.$1') : null;
}

function mapChartEntry(entry) {
  const images = Array.isArray(entry['im:image']) ? entry['im:image'] : [entry['im:image']].filter(Boolean);
  const poster = images.length ? upscaleArtwork(images[images.length - 1].label) : null;
  return {
    source: 'itunes',
    source_id: entry.id?.attributes?.['im:id'],
    media_type: 'movie',
    type: 'movie',
    title: entry['im:name']?.label,
    poster,
    year: (entry.releaseDate?.attributes?.label || entry.releaseDate?.label || '').slice(0, 4),
    note: null,
    genre: entry.category?.attributes?.label || null,
  };
}

export async function topMovies() {
  const resp = await fetch(CHART_URL);
  if (!resp.ok) {
    const err = new Error(`Erreur iTunes (${resp.status})`);
    err.status = 502;
    throw err;
  }
  const data = await resp.json();
  const entries = data.feed?.entry || [];
  return entries.map(mapChartEntry).filter((m) => m.source_id);
}

export async function getMovieDetails(sourceId) {
  const url = new URL(LOOKUP_URL);
  url.searchParams.set('id', sourceId);
  url.searchParams.set('country', 'FR');
  const resp = await fetch(url);
  if (!resp.ok) {
    const err = new Error(`Erreur iTunes (${resp.status})`);
    err.status = 502;
    throw err;
  }
  const data = await resp.json();
  const movie = data.results?.[0];
  if (!movie) {
    const err = new Error('Film introuvable.');
    err.status = 404;
    throw err;
  }
  return {
    source: 'itunes',
    source_id: String(movie.trackId),
    title: movie.trackName,
    poster: upscaleArtwork(movie.artworkUrl100),
    backdrop: null,
    synopsis: movie.longDescription || movie.shortDescription || '',
    note: null,
    genres: movie.primaryGenreName ? [movie.primaryGenreName] : [],
    duration: movie.trackTimeMillis ? Math.round(movie.trackTimeMillis / 60000) : null,
    release_date: movie.releaseDate ? movie.releaseDate.slice(0, 10) : null,
  };
}
