import { Router } from 'express';
import { db } from '../db/index.js';
import * as tmdb from '../services/tmdb.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

function annotateAdded(req, results) {
  const showIds = new Set(
    db.prepare(`SELECT tmdb_id FROM shows s JOIN user_shows us ON us.show_id = s.id WHERE us.user_id = ?`)
      .all(req.user.id).map((r) => r.tmdb_id)
  );
  const movieIds = new Set(
    db.prepare(`SELECT tmdb_id FROM movies m JOIN user_movies um ON um.movie_id = m.id WHERE um.user_id = ?`)
      .all(req.user.id).map((r) => r.tmdb_id)
  );
  return results.map((r) => ({
    ...r,
    already_added: r.media_type === 'movie' ? movieIds.has(r.tmdb_id) : showIds.has(r.tmdb_id),
  }));
}

router.get('/search', async (req, res, next) => {
  try {
    const { q, page } = req.query;
    if (!q) return res.json({ page: 1, total_pages: 0, results: [] });
    const data = await tmdb.searchMulti(q, Number(page) || 1);
    res.json({ ...data, results: annotateAdded(req, data.results) });
  } catch (e) { next(e); }
});

router.get('/trending', async (req, res, next) => {
  try {
    const { media_type = 'all' } = req.query;
    const results = await tmdb.trending(media_type);
    res.json(annotateAdded(req, results));
  } catch (e) { next(e); }
});

router.get('/discover/:mediaType', async (req, res, next) => {
  try {
    const { mediaType } = req.params;
    if (!['tv', 'movie'].includes(mediaType)) return res.status(400).json({ error: 'Type invalide.' });
    const { genre, sort, page } = req.query;
    const data = await tmdb.discover(mediaType, { genre, sort, page: Number(page) || 1 });
    res.json({ ...data, results: annotateAdded(req, data.results) });
  } catch (e) { next(e); }
});

router.get('/genres/:mediaType', async (req, res, next) => {
  try {
    res.json(await tmdb.genreList(req.params.mediaType));
  } catch (e) { next(e); }
});

router.get('/tv/:tmdbId', async (req, res, next) => {
  try {
    const details = await tmdb.getTvDetails(req.params.tmdbId);
    const already = db.prepare(`SELECT 1 FROM user_shows us JOIN shows s ON s.id = us.show_id
      WHERE us.user_id = ? AND s.tmdb_id = ?`).get(req.user.id, req.params.tmdbId);
    res.json({ ...details, already_added: !!already });
  } catch (e) { next(e); }
});

router.get('/movie/:tmdbId', async (req, res, next) => {
  try {
    const details = await tmdb.getMovieDetails(req.params.tmdbId);
    const already = db.prepare(`SELECT 1 FROM user_movies um JOIN movies m ON m.id = um.movie_id
      WHERE um.user_id = ? AND m.tmdb_id = ?`).get(req.user.id, req.params.tmdbId);
    res.json({ ...details, already_added: !!already });
  } catch (e) { next(e); }
});

export default router;
