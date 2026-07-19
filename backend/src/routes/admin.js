import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { isDebugEnabled, setDebugEnabled, getLogs, log as debugLog } from '../services/debugLog.js';
import { cacheMovie } from '../services/catalog.js';
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
// `duration` was tracked (or added via the Wikipedia source, which never reported one): at that
// scale it can take dozens of visits to actually catch up, which reads as "still just broken"
// rather than "still healing". This runs the same repair across every incomplete movie in the
// catalog (not just one user's list) in one go, still throttled the same way to stay gentle on
// Wikipedia/Wikidata. Enable debug mode first (above) to watch it progress.
let backfillRunning = false;
router.get('/movies/missing-duration-count', (req, res) => {
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM movies WHERE duration IS NULL`).get();
  res.json({ count, running: backfillRunning });
});

router.post('/movies/backfill-durations', (req, res) => {
  if (backfillRunning) return res.status(409).json({ error: 'Une réparation est déjà en cours.' });
  const rows = db.prepare(`SELECT source, source_id FROM movies WHERE duration IS NULL`).all();
  if (!rows.length) return res.json({ message: 'Aucun film à réparer.', count: 0 });

  backfillRunning = true;
  debugLog('backfill', `Réparation de ${rows.length} films sans durée démarrée.`);
  mapWithLimit(rows, 2, async (r) => {
    try {
      await cacheMovie(r.source, r.source_id, { posterOnly: true });
    } catch (error) {
      debugLog('backfill', `Échec pour ${r.source}:${r.source_id} : ${error.message}`);
    }
  })
    .then(() => debugLog('backfill', `Réparation terminée (${rows.length} films traités).`))
    .finally(() => { backfillRunning = false; });

  res.json({ message: `Réparation de ${rows.length} films lancée en arrière-plan.`, count: rows.length });
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
