import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { cacheShow } from '../services/catalog.js';
import * as tvmaze from '../services/tvmaze.js';
import { translateToFrench } from '../services/translate.js';

// TVmaze synopses are always in English; only that direction needs translating for
// the French-language preference (Wikipedia/iTunes movie summaries are already fetched in French).
async function localizedSynopsis(userShow, language) {
  if (language !== 'fr' || !userShow.synopsis) return userShow.synopsis;
  if (userShow.synopsis_fr) return userShow.synopsis_fr;
  try {
    const translated = await translateToFrench(userShow.synopsis);
    db.prepare('UPDATE shows SET synopsis_fr = ? WHERE id = ?').run(translated, userShow.show_id);
    return translated;
  } catch {
    return userShow.synopsis;
  }
}

const router = Router();
router.use(requireAuth);

function showProgress(userId, showId) {
  const total = db.prepare('SELECT COUNT(*) c FROM episodes WHERE show_id = ?').get(showId).c;
  const watched = db.prepare(`SELECT COUNT(*) c FROM user_episodes ue
    JOIN episodes e ON e.id = ue.episode_id
    WHERE ue.user_id = ? AND e.show_id = ? AND ue.watched = 1`).get(userId, showId).c;
  return { watched, total };
}

router.get('/', (req, res) => {
  const { filter, type, sort } = req.query;
  let rows = db.prepare(`
    SELECT us.*, s.* , us.status as user_status, s.id as show_id
    FROM user_shows us JOIN shows s ON s.id = us.show_id
    WHERE us.user_id = ?
  `).all(req.user.id);

  rows = rows.map((r) => {
    const progress = showProgress(req.user.id, r.show_id);
    return {
      show_id: r.show_id,
      source_id: r.source_id,
      type: r.type,
      title: r.title,
      poster: r.poster,
      note: r.note,
      status: r.user_status,
      personal_rating: r.personal_rating,
      added_at: r.added_at,
      progress: {
        watched: progress.watched,
        total: progress.total,
        percent: progress.total ? Math.round((progress.watched / progress.total) * 100) : 0,
      },
    };
  });

  if (filter === 'in_progress' || filter === 'completed') {
    rows = rows.filter((r) => r.status === filter);
  }
  if (type === 'serie' || type === 'anime') {
    rows = rows.filter((r) => r.type === type);
  }
  if (sort === 'alpha') rows.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === 'progress') rows.sort((a, b) => b.progress.percent - a.progress.percent);
  else rows.sort((a, b) => new Date(b.added_at) - new Date(a.added_at));

  res.json(rows);
});

router.post('/', async (req, res, next) => {
  try {
    const { source_id } = req.body || {};
    if (!source_id) return res.status(400).json({ error: 'source_id requis.' });
    const show = await cacheShow(source_id);
    db.prepare(`INSERT INTO user_shows (user_id, show_id) VALUES (?, ?)
      ON CONFLICT(user_id, show_id) DO NOTHING`).run(req.user.id, show.id);
    res.status(201).json({ show_id: show.id });
  } catch (e) { next(e); }
});

router.get('/:showId', async (req, res, next) => {
  try {
    const { showId } = req.params;
    const userShow = db.prepare(`SELECT us.*, s.* FROM user_shows us JOIN shows s ON s.id = us.show_id
      WHERE us.user_id = ? AND us.show_id = ?`).get(req.user.id, showId);
    if (!userShow) return res.status(404).json({ error: 'Série introuvable dans votre liste.' });

    const episodes = db.prepare(`SELECT e.*, COALESCE(ue.watched, 0) as watched, ue.watched_at
      FROM episodes e LEFT JOIN user_episodes ue ON ue.episode_id = e.id AND ue.user_id = ?
      WHERE e.show_id = ? ORDER BY e.season, e.episode_number`).all(req.user.id, showId);

    const seasons = {};
    for (const ep of episodes) {
      seasons[ep.season] = seasons[ep.season] || [];
      seasons[ep.season].push(ep);
    }

    const addedByCount = db.prepare('SELECT COUNT(*) c FROM user_shows WHERE show_id = ?').get(showId).c;
    const [cast, synopsis] = await Promise.all([
      tvmaze.getCast(userShow.source_id).catch(() => []),
      localizedSynopsis(userShow, req.user.language),
    ]);

    res.json({
      show_id: userShow.show_id,
      source_id: userShow.source_id,
      type: userShow.type,
      title: userShow.title,
      poster: userShow.poster,
      backdrop: userShow.backdrop,
      synopsis,
      note: userShow.note,
      genres: JSON.parse(userShow.genres || '[]'),
      air_status: userShow.air_status,
      platform: userShow.platform,
      schedule_day: userShow.schedule_day,
      schedule_time: userShow.schedule_time,
      runtime: userShow.runtime,
      next_episode: JSON.parse(userShow.next_episode_json || 'null'),
      added_by_count: addedByCount,
      cast,
      status: userShow.status,
      personal_rating: userShow.personal_rating,
      personal_review: userShow.personal_review,
      seasons: Object.entries(seasons).map(([season, eps]) => ({ season: Number(season), episodes: eps })),
    });
  } catch (e) { next(e); }
});

router.patch('/:showId/rating', (req, res) => {
  const { personal_rating, personal_review } = req.body || {};
  const result = db.prepare(`UPDATE user_shows SET personal_rating = ?, personal_review = ?
    WHERE user_id = ? AND show_id = ?`).run(personal_rating ?? null, personal_review ?? null, req.user.id, req.params.showId);
  if (result.changes === 0) return res.status(404).json({ error: 'Série introuvable dans votre liste.' });
  res.json({ message: 'Avis enregistré.' });
});

function recomputeShowStatus(userId, showId) {
  const { watched, total } = showProgress(userId, showId);
  if (total > 0 && watched === total) {
    db.prepare(`UPDATE user_shows SET status = 'completed' WHERE user_id = ? AND show_id = ?`).run(userId, showId);
  } else {
    db.prepare(`UPDATE user_shows SET status = 'in_progress' WHERE user_id = ? AND show_id = ?`).run(userId, showId);
  }
}

router.put('/:showId/episodes/:episodeId', (req, res) => {
  const { showId, episodeId } = req.params;
  const { watched } = req.body || {};
  const episode = db.prepare('SELECT * FROM episodes WHERE id = ? AND show_id = ?').get(episodeId, showId);
  if (!episode) return res.status(404).json({ error: 'Épisode introuvable.' });

  db.prepare(`INSERT INTO user_episodes (user_id, episode_id, watched, watched_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, episode_id) DO UPDATE SET watched = excluded.watched, watched_at = excluded.watched_at`)
    .run(req.user.id, episodeId, watched ? 1 : 0, watched ? new Date().toISOString() : null);

  recomputeShowStatus(req.user.id, showId);
  res.json({ progress: showProgress(req.user.id, showId) });
});

router.put('/:showId/seasons/:season', (req, res) => {
  const { showId, season } = req.params;
  const { watched = true } = req.body || {};
  const episodes = db.prepare('SELECT id FROM episodes WHERE show_id = ? AND season = ?').all(showId, season);
  const now = new Date().toISOString();
  const upsert = db.prepare(`INSERT INTO user_episodes (user_id, episode_id, watched, watched_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, episode_id) DO UPDATE SET watched = excluded.watched, watched_at = excluded.watched_at`);
  const tx = db.transaction(() => {
    for (const ep of episodes) upsert.run(req.user.id, ep.id, watched ? 1 : 0, watched ? now : null);
  });
  tx();
  recomputeShowStatus(req.user.id, showId);
  res.json({ progress: showProgress(req.user.id, showId) });
});

router.post('/:showId/mark-complete', (req, res) => {
  const { showId } = req.params;
  const episodes = db.prepare('SELECT id FROM episodes WHERE show_id = ?').all(showId);
  const now = new Date().toISOString();
  const upsert = db.prepare(`INSERT INTO user_episodes (user_id, episode_id, watched, watched_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(user_id, episode_id) DO UPDATE SET watched = 1, watched_at = excluded.watched_at`);
  const tx = db.transaction(() => {
    for (const ep of episodes) upsert.run(req.user.id, ep.id, now);
  });
  tx();
  db.prepare(`UPDATE user_shows SET status = 'completed' WHERE user_id = ? AND show_id = ?`).run(req.user.id, showId);
  res.json({ message: 'Série marquée comme terminée.' });
});

router.delete('/:showId', (req, res) => {
  const result = db.prepare('DELETE FROM user_shows WHERE user_id = ? AND show_id = ?')
    .run(req.user.id, req.params.showId);
  if (result.changes === 0) return res.status(404).json({ error: 'Série introuvable dans votre liste.' });
  db.prepare(`DELETE FROM user_episodes WHERE user_id = ? AND episode_id IN
    (SELECT id FROM episodes WHERE show_id = ?)`).run(req.user.id, req.params.showId);
  res.json({ message: 'Série supprimée de votre liste.' });
});

export default router;
