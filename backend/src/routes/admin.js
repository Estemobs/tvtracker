import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { isDebugEnabled, setDebugEnabled, getLogs, log as debugLog } from '../services/debugLog.js';
import { cacheMovie } from '../services/catalog.js';
import * as itunes from '../services/itunes.js';
import * as wikipedia from '../services/wikipedia.js';
import * as justwatch from '../services/justwatch.js';
import * as tmdb from '../services/tmdb.js';
import * as wikidata from '../services/wikidata.js';
import { mapWithLimit } from '../services/httpRetry.js';

const router = Router();
router.use(requireAuth, requireAdmin);

// A toggle to turn on verbose logging (every external HTTP call, cache refresh timing) into an
// in-memory buffer readable from here — for diagnosing a stuck/blank page without shell access to
// `docker logs`. See services/debugLog.js for what gets logged and why it's off by default.
router.get('/debug', (req, res) => {
  res.json({ enabled: isDebugEnabled(), logs: getLogs() });
});

router.post('/debug/toggle', (req, res) => {
  setDebugEnabled(!!req.body?.enabled);
  res.json({ enabled: isDebugEnabled() });
});

// The list page's own background healing (movies.js) only ever fixes 2 movies per visit — fine
// for an occasional gap, hopeless for someone with a couple hundred movies imported before
// `duration`/`release_date` were tracked (or added via a legacy source that barely reported
// either): at that scale it can take dozens of visits to actually catch up, which reads as "still
// just broken" rather than "still healing". This runs the same repair across every incomplete
// movie in the catalog (not just one user's list) in one go, still throttled the same way to stay
// gentle on the external metadata services. Enable debug mode first (above) to watch it progress.
let backfillRunning = false;
const MISSING_INFO_WHERE = `poster IS NULL OR duration IS NULL OR release_date IS NULL`;
router.get('/movies/missing-duration-count', (req, res) => {
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM movies WHERE ${MISSING_INFO_WHERE}`).get();
  res.json({ count, running: backfillRunning });
});

router.post('/movies/backfill-durations', (req, res) => {
  if (backfillRunning) return res.status(409).json({ error: 'Une réparation est déjà en cours.' });
  const rows = db.prepare(`SELECT source, source_id FROM movies WHERE ${MISSING_INFO_WHERE}`).all();
  if (!rows.length) return res.json({ message: 'Aucun film à réparer.', count: 0 });

  backfillRunning = true;
  debugLog('backfill', `Réparation de ${rows.length} films incomplets démarrée.`);
  mapWithLimit(rows, 2, async (r) => {
    try {
      await repairMovie(r);
    } catch (error) {
      debugLog('backfill', `Échec pour ${r.source}:${r.source_id} : ${error.message}`);
    }
  })
    .then(() => debugLog('backfill', `Réparation terminée (${rows.length} films traités).`))
    .finally(() => { backfillRunning = false; });

  res.json({ message: `Réparation de ${rows.length} films lancée en arrière-plan.`, count: rows.length });
});

/// ///////////////////////////////////////////////////////////
/// RÉPARATION COMPLÈTE DU CATALOGUE FILMS (avec fallbacks multi-sources)
/// ///////////////////////////////////////////////////////////

let fullRepairRunning = false;

router.get('/movies/full-repair-status', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM movies').get().count;
  const incomplete = db.prepare(`SELECT COUNT(*) as count FROM movies WHERE
    poster IS NULL OR backdrop IS NULL OR duration IS NULL OR release_date IS NULL OR synopsis IS NULL OR synopsis = ''`).get().count;
  res.json({ total, incomplete, running: fullRepairRunning });
});

async function findBestPoster(title, releaseDate, imdbId = null) {
  // 1. TMDB (meilleure couverture)
  const tmdbPoster = await tmdb.findPoster(title, { year: releaseDate?.slice(0, 4) }).catch(() => null);
  if (tmdbPoster) return { poster: tmdbPoster, source: 'tmdb' };

  // 2. Wikidata via IMDb ID
  if (imdbId) {
    const wikibaseItem = await wikidata.findByImdbId(imdbId).catch(() => null);
    if (wikibaseItem) {
      const wdPoster = await wikidata.getPoster(wikibaseItem).catch(() => null);
      if (wdPoster) return { poster: wdPoster, source: 'wikidata' };
    }
  }

  // 3. Wikipédia française
  const frArticle = await wikipedia.findFrenchArticle(title).catch(() => null);
  if (frArticle?.wikibase_item) {
    const wdPoster = await wikidata.getPoster(frArticle.wikibase_item).catch(() => null);
    if (wdPoster) return { poster: wdPoster, source: 'wikipedia' };
  }

  return null;
}

async function findBestBackdrop(title, releaseDate, imdbId = null, fallbackPoster = null) {
  // TMDB n'a pas de backdrop dédié gratuit, on réutilise le poster
  // Wikidata n'a pas de backdrop
  // On retourne le poster comme fallback
  return fallbackPoster;
}

async function findDurationAndRelease(title, releaseDate) {
  // JustWatch a les durées et dates précises
  const jw = await justwatch.findByTitle(title, 'MOVIE').catch(() => null);
  if (jw) {
    return {
      duration: jw.runtime ?? null,
      release_date: jw.releaseDate ?? null,
    };
  }
  return { duration: null, release_date: null };
}

async function findSynopsis(title, source, sourceId) {
  // Essaie la source d'origine d'abord
  try {
    if (source === 'itunes') {
      const details = await itunes.getMovieDetails(sourceId);
      if (details.synopsis) return details.synopsis;
    } else if (source === 'wikipedia') {
      const details = await wikipedia.getMovieSummary(sourceId);
      if (details.synopsis) return details.synopsis;
    }
  } catch { /* ignore */ }
  return null;
}

async function repairSingleMovie(movie) {
  const { source, source_id, title, imdb_id, release_date } = movie;
  let updated = false;
  const updates = {};

  // 1. Poster manquant
  if (!movie.poster || !movie.backdrop) {
    const posterResult = await findBestPoster(title, release_date, imdb_id);
    if (posterResult?.poster) {
      updates.poster = posterResult.poster;
      if (!movie.backdrop) updates.backdrop = posterResult.poster;
      updated = true;
      debugLog('full-repair', `Poster trouvé pour "${title}" via ${posterResult.source}`);
    }
  }

  // 2. Durée / date de sortie manquantes
  if (!movie.duration || !movie.release_date) {
    const details = await findDurationAndRelease(title, release_date);
    if (details.duration && !movie.duration) {
      updates.duration = details.duration;
      updated = true;
    }
    if (details.release_date && !movie.release_date) {
      updates.release_date = details.release_date;
      updated = true;
    }
  }

  // 3. Synopsis manquant
  if (!movie.synopsis || movie.synopsis === '') {
    const synopsis = await findSynopsis(title, source, source_id);
    if (synopsis) {
      updates.synopsis = synopsis;
      updated = true;
    }
  }

  if (updated && Object.keys(updates).length > 0) {
    const setClause = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
    // Only pass the fields being updated + id for WHERE clause
    const params = { ...updates, id: movie.id };
    db.prepare(`UPDATE movies SET ${setClause}, updated_at = datetime('now') WHERE id = @id`)
      .run(params);
  }

  return updated;
}

router.post('/movies/full-repair', (req, res) => {
  if (fullRepairRunning) return res.status(409).json({ error: 'Une réparation complète est déjà en cours.' });

  const movies = db.prepare(`
    SELECT id, source, source_id, imdb_id, title, poster, backdrop, duration, release_date, synopsis
    FROM movies
    ORDER BY updated_at ASC
  `).all();

  if (!movies.length) return res.json({ message: 'Aucun film en base.', total: 0, fixed: 0 });

  fullRepairRunning = true;

  debugLog('full-repair', `Réparation complète démarrée pour ${movies.length} films.`);

  // ÉTAPE 1: Réparer les liaisons user_movies orphelines (IDs cassés par migration)
  // Nécessite la migration 012 (source/source_id dans user_movies)
  let relinkedCount = 0;
  try {
    const orphaned = db.prepare(`
      SELECT um.id, um.source, um.source_id
      FROM user_movies um
      LEFT JOIN movies m ON m.id = um.movie_id
      WHERE m.id IS NULL AND um.source IS NOT NULL AND um.source_id IS NOT NULL
    `).all();

    if (orphaned.length > 0) {
      debugLog('full-repair', `${orphaned.length} liaisons orphelines détectées avec source/source_id, réparation...`);
      const movieMap = new Map();
      db.prepare(`SELECT id, source, source_id FROM movies`).all().forEach(m => {
        movieMap.set(`${m.source}:${m.source_id}`, m.id);
      });

      const updateStmt = db.prepare(`UPDATE user_movies SET movie_id = ? WHERE id = ?`);
      const tx = db.transaction(() => {
        for (const link of orphaned) {
          const newId = movieMap.get(`${link.source}:${link.source_id}`);
          if (newId) {
            updateStmt.run(newId, link.id);
            relinkedCount++;
          }
        }
      });
      tx();
      debugLog('full-repair', `${relinkedCount}/${orphaned.length} liaisons rétablies.`);
    }
  } catch (e) {
    debugLog('full-repair', `Réparation orphelins ignorée (migration 012 manquante ou erreur) : ${e.message}`);
  }

  mapWithLimit(movies, 2, async (movie) => {
    try {
      return await repairSingleMovie(movie);
    } catch (error) {
      debugLog('full-repair', `Échec pour ${movie.title} (${movie.source}:${movie.source_id}) : ${error.message}`);
      return false;
    }
  })
    .then((results) => {
      const fixedCount = results.filter(Boolean).length;
      debugLog('full-repair', `Réparation complète terminée : ${fixedCount}/${movies.length} films corrigés, ${relinkedCount} liaisons user_movies rétablies.`);
      fullRepairRunning = false;
    })
    .catch((err) => {
      debugLog('full-repair', `Erreur fatale : ${err.message}`);
      fullRepairRunning = false;
    });

  res.json({
    message: `Réparation complète de ${movies.length} films lancée en arrière-plan.`,
    total: movies.length,
    fixed: 0
  });
});

router.get('/users/pending', (req, res) => {
  const rows = db.prepare(`SELECT id, username, email, created_at FROM users
    WHERE status = 'pending' ORDER BY created_at ASC`).all();
  res.json(rows);
});

router.get('/users', (req, res) => {
  const rows = db.prepare(`SELECT id, username, email, role, status, created_at FROM users
    ORDER BY created_at DESC`).all();
  res.json(rows);
});

router.post('/users/:id/approve', (req, res) => {
  const result = db.prepare(`UPDATE users SET status = 'active' WHERE id = ? AND status = 'pending'`)
    .run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Utilisateur en attente introuvable.' });
  res.json({ message: 'Compte approuvé.' });
});

router.post('/users/:id/refuse', (req, res) => {
  const result = db.prepare(`UPDATE users SET status = 'refused' WHERE id = ? AND status = 'pending'`)
    .run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Utilisateur en attente introuvable.' });
  res.json({ message: 'Inscription refusée.' });
});

router.post('/users/:id/disable', (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'Vous ne pouvez pas désactiver votre propre compte.' });
  }
  const result = db.prepare(`UPDATE users SET status = 'disabled' WHERE id = ?`).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  res.json({ message: 'Compte désactivé.' });
});

router.post('/users/:id/enable', (req, res) => {
  const result = db.prepare(`UPDATE users SET status = 'active' WHERE id = ?`).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  res.json({ message: 'Compte réactivé.' });
});

router.delete('/users/:id', (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
  }
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  res.json({ message: 'Compte supprimé.' });
});

export default router;
