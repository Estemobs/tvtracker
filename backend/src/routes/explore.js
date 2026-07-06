import { Router } from 'express';
import { db } from '../db/index.js';
import * as tvmaze from '../services/tvmaze.js';
import * as itunes from '../services/itunes.js';
import * as wikipedia from '../services/wikipedia.js';
import { enrichMovieWithWikidata } from '../services/catalog.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

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
      wikipedia.searchMovies(q).catch(() => []),
    ]);
    res.json({ results: annotateAdded(req, [...shows, ...movies]) });
  } catch (e) { next(e); }
});

router.get('/trending', async (req, res, next) => {
  try {
    const { media_type = 'all' } = req.query;
    const [shows, movies] = await Promise.all([
      media_type === 'movie' ? [] : tvmaze.scheduleHighlights().catch(() => []),
      media_type === 'tv' || media_type === 'anime' ? [] : itunes.topMovies().catch(() => []),
    ]);
    res.json(annotateAdded(req, [...shows, ...movies]));
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
    res.json({ ...details, cast, added_by_count: addedByCount, already_added: !!already });
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

    res.json({ ...details, added_by_count: addedByCount, already_added: !!already });
  } catch (e) { next(e); }
});

router.get('/actor/:personId', async (req, res, next) => {
  try {
    const [person, filmography] = await Promise.all([
      tvmaze.getPerson(req.params.personId),
      tvmaze.getPersonFilmography(req.params.personId),
    ]);
    const bio = await wikipedia.getPersonBio(person.name).catch(() => null);
    res.json({ ...person, bio, filmography });
  } catch (e) { next(e); }
});

export default router;
