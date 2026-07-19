import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { cacheMovie } from '../services/catalog.js';
import { mapWithLimit } from '../services/httpRetry.js';

const router = Router();
router.use(requireAuth);

// The list itself must stay instant (a bulk re-enrichment on every load was the exact "list
// takes forever" problem fixed earlier) — but a movie missing its poster here would otherwise
// only ever heal once someone happens to open its detail page. Kick off a background re-fetch
// for any row still missing a poster; it'll show up correctly on the next load instead. The
// in-flight set just avoids piling up duplicate fetches if the list is reloaded again before
// the first one finishes.
//
// Two things this deliberately avoids, both of which turned "open the movie list" into "every
// other Wikipedia-backed feature on the site stalls for the next 20-30s": posterOnly skips the
// cast/rating/next-installment enrichment this view never shows anyway (each of those is its own
// Wikidata round trip); mapWithLimit spreads the re-fetches out instead of firing all of a list's
// poster-less movies at Wikipedia/Wikidata simultaneously, which was enough of a burst to trip
// their rate limiter and jam the shared per-host cooldown for every other request in flight.
const healingMovies = new Set();
async function healPostersInBackground(rows) {
  const toHeal = rows.filter((r) => !r.poster && !healingMovies.has(`${r.source}:${r.source_id}`));
  if (!toHeal.length) return;
  for (const r of toHeal) healingMovies.add(`${r.source}:${r.source_id}`);
  try {
    await mapWithLimit(toHeal, 2, (r) => cacheMovie(r.source, r.source_id, { posterOnly: true }).catch(() => {}));
  } finally {
    for (const r of toHeal) healingMovies.delete(`${r.source}:${r.source_id}`);
  }
}

router.get('/', (req, res) => {
  const { filter, sort } = req.query;
  let rows = db.prepare(`SELECT um.*, m.* , um.status as user_status, m.id as movie_id
    FROM user_movies um JOIN movies m ON m.id = um.movie_id WHERE um.user_id = ?`).all(req.user.id);

  void healPostersInBackground(rows);

  rows = rows.map((r) => ({
    movie_id: r.movie_id,
    source: r.source,
    source_id: r.source_id,
    title: r.title,
    poster: r.poster,
    note: r.note,
    duration: r.duration,
    status: r.user_status,
    personal_rating: r.personal_rating,
    added_at: r.added_at,
    watched_at: r.watched_at,
  }));

  if (filter === 'to_watch' || filter === 'watched') {
    rows = rows.filter((r) => r.status === filter);
  }
  if (sort === 'alpha') rows.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === 'note') rows.sort((a, b) => (b.note || 0) - (a.note || 0));
  else rows.sort((a, b) => new Date(b.added_at) - new Date(a.added_at));

  res.json(rows);
});

router.post('/', async (req, res, next) => {
  try {
    const { source, source_id } = req.body || {};
    if (!source || !source_id) return res.status(400).json({ error: 'source et source_id requis.' });
    const movie = await cacheMovie(source, source_id);
    db.prepare(`INSERT INTO user_movies (user_id, movie_id) VALUES (?, ?)
      ON CONFLICT(user_id, movie_id) DO NOTHING`).run(req.user.id, movie.id);
    res.status(201).json({ movie_id: movie.id });
  } catch (e) { next(e); }
});

router.get('/:movieId', async (req, res, next) => {
  try {
    let row = db.prepare(`SELECT um.*, m.* FROM user_movies um JOIN movies m ON m.id = um.movie_id
      WHERE um.user_id = ? AND um.movie_id = ?`).get(req.user.id, req.params.movieId);
    if (!row) return res.status(404).json({ error: 'Film introuvable dans votre liste.' });

    // The list view and this detail route only ever SELECT the cached row — nothing else
    // re-triggers cacheMovie once a movie has been added, so a poster/cast left incomplete
    // (bulk import skips full enrichment for speed, or a past fetch failed) would otherwise
    // stay incomplete forever. Re-run cacheMovie here; it only actually re-fetches when stale
    // or incomplete, so this is a no-op for the common case of an already-complete movie.
    await cacheMovie(row.source, row.source_id).catch(() => {});
    row = db.prepare(`SELECT um.*, m.* FROM user_movies um JOIN movies m ON m.id = um.movie_id
      WHERE um.user_id = ? AND um.movie_id = ?`).get(req.user.id, req.params.movieId);

    const addedByCount = db.prepare('SELECT COUNT(*) c FROM user_movies WHERE movie_id = ?').get(row.movie_id).c;
    res.json({
      movie_id: row.movie_id,
      source: row.source,
      source_id: row.source_id,
      title: row.title,
      poster: row.poster,
      backdrop: row.backdrop,
      synopsis: row.synopsis,
      duration: row.duration,
      note: row.note,
      genres: JSON.parse(row.genres || '[]'),
      release_date: row.release_date,
      platform: row.platform,
      cast: JSON.parse(row.cast_json || '[]'),
      next_installment: JSON.parse(row.next_installment_json || 'null'),
      added_by_count: addedByCount,
      status: row.status,
      personal_rating: row.personal_rating,
    });
  } catch (e) { next(e); }
});

router.patch('/:movieId/status', (req, res) => {
  const { status } = req.body || {};
  if (!['to_watch', 'watched'].includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
  const result = db.prepare(`UPDATE user_movies SET status = ?, watched_at = ?
    WHERE user_id = ? AND movie_id = ?`)
    .run(status, status === 'watched' ? new Date().toISOString() : null, req.user.id, req.params.movieId);
  if (result.changes === 0) return res.status(404).json({ error: 'Film introuvable dans votre liste.' });
  res.json({ message: 'Statut mis à jour.' });
});

router.patch('/:movieId/rating', (req, res) => {
  const { personal_rating } = req.body || {};
  const result = db.prepare(`UPDATE user_movies SET personal_rating = ? WHERE user_id = ? AND movie_id = ?`)
    .run(personal_rating ?? null, req.user.id, req.params.movieId);
  if (result.changes === 0) return res.status(404).json({ error: 'Film introuvable dans votre liste.' });
  res.json({ message: 'Note enregistrée.' });
});

router.delete('/:movieId', (req, res) => {
  const result = db.prepare('DELETE FROM user_movies WHERE user_id = ? AND movie_id = ?')
    .run(req.user.id, req.params.movieId);
  if (result.changes === 0) return res.status(404).json({ error: 'Film introuvable dans votre liste.' });
  res.json({ message: 'Film supprimé de votre liste.' });
});

export default router;
