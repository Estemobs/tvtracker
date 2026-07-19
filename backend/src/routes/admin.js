import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { isDebugEnabled, setDebugEnabled, getLogs } from '../services/debugLog.js';

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
