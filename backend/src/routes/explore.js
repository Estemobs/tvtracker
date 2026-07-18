import { Router } from 'express';
import { db } from '../db/index.js';
import * as tvmaze from '../services/tvmaze.js';
import * as itunes from '../services/itunes.js';
import * as wikipedia from '../services/wikipedia.js';
import * as wikidata from '../services/wikidata.js';
import { enrichMovieWithWikidata } from '../services/catalog.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Shows and movies come from independent sources/queries that can each legitimately return the
// same source+source_id more than once (e.g. a French-search hit and its English-fallback
// resolution landing on the same Wikipedia article) — collapse those before they reach the UI.
function dedupe(results) {
  const seen = new Set();
  return results.filter((r) => {
    const key = `${r.source}:${r.source_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function annotateAdded(req, results) {
  const showKeys = new Set(
    db.prepare(`SELECT source, source_id FROM shows s JOIN user_shows us ON us.show_id = s.id WHERE us.user_id = ?`)
      .all(req.user.id).map((r) => `${r.source}:${r.source_id}`)
  );
  const movieKeys = new Set(
    db.prepare(`SELECT source, source_id FROM movies m JOIN user_movies um ON um.movie_id = m.id WHERE um.user_id = ?`)
      .all(req.user.id).map((r) => `${r.source}:${r.source_id}`)
  );
  return results.map((r) => ({
    ...r,
    already_added: (r.media_type === 'movie' ? movieKeys : showKeys).has(`${r.source}:${r.source_id}`),
  }));
}

router.get('/search', async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q) return res.json({ results: [] });
    const [shows, movies] = await Promise.all([
      tvmaze.searchShows(q).catch(() => []),
      wikipedia.searchMoviesAnyLanguage(q).catch(() => []),
    ]);

    res.json({ results: annotateAdded(req, dedupe([...shows, ...movies])) });
  } catch (e) { next(e); }
});

// Ranks locally-tracked shows/movies by how many of this app's own users follow them — the one
// "most watched" signal we can offer honestly, since none of our keyless sources (TVmaze,
// iTunes, Wikipedia) expose real viewership data.
function mostFollowedContent() {
  const showRows = db.prepare(`
    SELECT s.source, s.source_id, s.type, s.title, s.poster, s.note, s.nb_seasons, COUNT(us.user_id) AS followers
    FROM shows s JOIN user_shows us ON us.show_id = s.id
    GROUP BY s.id
    ORDER BY followers DESC
    LIMIT 20
  `).all().map((r) => ({
    source: r.source, source_id: r.source_id, media_type: 'tv', type: r.type,
    title: r.title, poster: r.poster, year: null, note: r.note, nb_seasons: r.nb_seasons, followers: r.followers,
  }));
  const movieRows = db.prepare(`
    SELECT m.source, m.source_id, m.title, m.poster, m.release_date, COUNT(um.user_id) AS followers
    FROM movies m JOIN user_movies um ON um.movie_id = m.id
    GROUP BY m.id
    ORDER BY followers DESC
    LIMIT 20
  `).all().map((r) => ({
    source: r.source, source_id: r.source_id, media_type: 'movie', type: 'movie',
    title: r.title, poster: r.poster, year: (r.release_date || '').slice(0, 4), note: null, followers: r.followers,
  }));
  return [...showRows, ...movieRows].sort((a, b) => b.followers - a.followers).slice(0, 20);
}

router.get('/trending', async (req, res, next) => {
  try {
    const currentYear = new Date().getFullYear();
    const [shows, movies] = await Promise.all([
      tvmaze.scheduleHighlights().catch(() => []),
      itunes.topMovies().catch(() => []),
    ]);

    const series = dedupe(shows.filter((s) => s.type === 'serie'));
    const animes = dedupe(shows.filter((s) => s.type === 'anime'));
    const uniqueMovies = dedupe(movies);
    const newSeries = series.filter((s) => s.year && Number(s.year) >= currentYear - 1);
    const newMovies = uniqueMovies.filter((m) => m.year && Number(m.year) >= currentYear - 1);
    const mostFollowed = dedupe(mostFollowedContent());

    res.json({
      trending: annotateAdded(req, dedupe([...shows, ...movies])),
      series: annotateAdded(req, series),
      animes: annotateAdded(req, animes),
      movies: annotateAdded(req, uniqueMovies),
      new_series: annotateAdded(req, newSeries),
      new_movies: annotateAdded(req, newMovies),
      most_followed: annotateAdded(req, mostFollowed),
    });
  } catch (e) { next(e); }
});

router.get('/discover/:mediaType', async (req, res, next) => {
  try {
    const { mediaType } = req.params;
    if (!['tv', 'movie'].includes(mediaType)) return res.status(400).json({ error: 'Type invalide.' });
    const { genre } = req.query;
    if (mediaType === 'tv') {
      const results = await tvmaze.discoverByGenre(genre);
      return res.json({ results: annotateAdded(req, results) });
    }
    const movies = await itunes.topMovies();
    const filtered = genre ? movies.filter((m) => m.genre === genre) : movies;
    res.json({ results: annotateAdded(req, filtered) });
  } catch (e) { next(e); }
});

router.get('/genres/:mediaType', (req, res) => {
  if (req.params.mediaType === 'tv') return res.json(tvmaze.GENRES);
  res.json(['Action & Adventure', 'Comedy', 'Drama', 'Horror', 'Romance', 'Science-Fiction', 'Thriller', 'Animation']);
});

router.get('/tv/:sourceId', async (req, res, next) => {
  try {
    const [details, cast] = await Promise.all([
      tvmaze.getShowDetails(req.params.sourceId),
      tvmaze.getCast(req.params.sourceId).catch(() => []),
    ]);
    const cachedShow = db.prepare(`SELECT id FROM shows WHERE source = 'tvmaze' AND source_id = ?`).get(req.params.sourceId);
    const addedByCount = cachedShow
      ? db.prepare('SELECT COUNT(*) c FROM user_shows WHERE show_id = ?').get(cachedShow.id).c
      : 0;
    const already = cachedShow
      ? db.prepare(`SELECT 1 FROM user_shows WHERE user_id = ? AND show_id = ?`).get(req.user.id, cachedShow.id)
      : null;
    res.json({ ...details, cast, added_by_count: addedByCount, already_added: !!already, show_id: already ? cachedShow.id : null });
  } catch (e) { next(e); }
});

router.get('/movie/:source/:sourceId', async (req, res, next) => {
  try {
    const { source, sourceId } = req.params;
    if (!['itunes', 'wikipedia'].includes(source)) return res.status(400).json({ error: 'Source invalide.' });
    const baseDetails = source === 'itunes'
      ? await itunes.getMovieDetails(sourceId)
      : await wikipedia.getMovieSummary(sourceId);
    const details = await enrichMovieWithWikidata(baseDetails);

    const cachedMovie = db.prepare('SELECT id FROM movies WHERE source = ? AND source_id = ?').get(source, sourceId);
    const addedByCount = cachedMovie
      ? db.prepare('SELECT COUNT(*) c FROM user_movies WHERE movie_id = ?').get(cachedMovie.id).c
      : 0;
    const already = cachedMovie
      ? db.prepare(`SELECT 1 FROM user_movies WHERE user_id = ? AND movie_id = ?`).get(req.user.id, cachedMovie.id)
      : null;

    res.json({ ...details, added_by_count: addedByCount, already_added: !!already, movie_id: already ? cachedMovie.id : null });
  } catch (e) { next(e); }
});

router.get('/actor/:personId', async (req, res, next) => {
  try {
    const { personId } = req.params;
    const isWikidataId = /^Q\d+$/.test(personId);

    const [person, filmography] = isWikidataId
      ? await Promise.all([wikidata.getPerson(personId), wikidata.getPersonFilmography(personId)])
      : await Promise.all([tvmaze.getPerson(personId), tvmaze.getPersonFilmography(personId)]);

    if (!person) return res.status(404).json({ error: 'Acteur introuvable.' });
    const bio = await wikipedia.getPersonBio(person.name).catch(() => null);
    res.json({ ...person, bio, filmography });
  } catch (e) { next(e); }
});

export default router;
