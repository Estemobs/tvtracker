import { Router } from 'express';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { db, DATA_DIR } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { importTvTimeArchive } from '../services/tvtimeImport.js';

const router = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(DATA_DIR, 'uploads'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `avatar-${req.user.id}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
      return cb(new Error('Format d\'image non supporté.'));
    }
    cb(null, true);
  },
});

const uploadArchive = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.zip') && file.mimetype !== 'application/zip') {
      return cb(new Error('Un fichier .zip est attendu (export RGPD TV Time).'));
    }
    cb(null, true);
  },
});

router.patch('/', (req, res) => {
  const { username, email, language } = req.body || {};
  const updates = [];
  const values = [];
  if (username) { updates.push('username = ?'); values.push(username); }
  if (email) { updates.push('email = ?'); values.push(email); }
  if (language) {
    if (!['fr', 'en'].includes(language)) return res.status(400).json({ error: 'Langue invalide.' });
    updates.push('language = ?'); values.push(language);
  }
  if (!updates.length) return res.status(400).json({ error: 'Aucune modification fournie.' });

  try {
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values, req.user.id);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Nom d\'utilisateur ou e-mail déjà utilisé.' });
    throw e;
  }
  res.json({ message: 'Profil mis à jour.' });
});

router.post('/avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier requis.' });
  const avatarPath = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatarPath, req.user.id);
  res.json({ avatar: avatarPath });
});

router.patch('/password', (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Champs requis.' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 8 caractères.' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
  }
  const password_hash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(password_hash, req.user.id);
  res.json({ message: 'Mot de passe mis à jour.' });
});

router.get('/stats', (req, res) => {
  const userId = req.user.id;

  const episodeMinutes = db.prepare(`
    SELECT COALESCE(SUM(e.duration), 0) as minutes, COUNT(*) as count
    FROM user_episodes ue JOIN episodes e ON e.id = ue.episode_id
    WHERE ue.user_id = ? AND ue.watched = 1
  `).get(userId);

  const movieMinutes = db.prepare(`
    SELECT COALESCE(SUM(m.duration), 0) as minutes, COUNT(*) as count
    FROM user_movies um JOIN movies m ON m.id = um.movie_id
    WHERE um.user_id = ? AND um.status = 'watched'
  `).get(userId);

  const seriesMinutes = db.prepare(`
    SELECT COALESCE(SUM(e.duration), 0) as minutes
    FROM user_episodes ue
    JOIN episodes e ON e.id = ue.episode_id
    JOIN shows s ON s.id = e.show_id
    WHERE ue.user_id = ? AND ue.watched = 1 AND s.type = 'serie'
  `).get(userId);

  const animeMinutes = db.prepare(`
    SELECT COALESCE(SUM(e.duration), 0) as minutes
    FROM user_episodes ue
    JOIN episodes e ON e.id = ue.episode_id
    JOIN shows s ON s.id = e.show_id
    WHERE ue.user_id = ? AND ue.watched = 1 AND s.type = 'anime'
  `).get(userId);

  const topShows = db.prepare(`
    SELECT s.title, s.poster, SUM(e.duration) as minutes
    FROM user_episodes ue
    JOIN episodes e ON e.id = ue.episode_id
    JOIN shows s ON s.id = e.show_id
    WHERE ue.user_id = ? AND ue.watched = 1
    GROUP BY s.id ORDER BY minutes DESC LIMIT 10
  `).all(userId);

  const completedShows = db.prepare(`
    SELECT s.source, s.source_id, s.title, s.poster, s.type FROM user_shows us JOIN shows s ON s.id = us.show_id
    WHERE us.user_id = ? AND us.status = 'completed'
  `).all(userId);

  const watchedMovies = db.prepare(`
    SELECT m.source, m.source_id, m.title, m.poster FROM user_movies um JOIN movies m ON m.id = um.movie_id
    WHERE um.user_id = ? AND um.status = 'watched'
  `).all(userId);

  res.json({
    total_minutes: episodeMinutes.minutes + movieMinutes.minutes,
    series_minutes: seriesMinutes.minutes,
    anime_minutes: animeMinutes.minutes,
    movies_minutes: movieMinutes.minutes,
    episodes_watched: episodeMinutes.count,
    movies_watched: movieMinutes.count,
    top_content: topShows,
    completed: {
      series: completedShows.filter((s) => s.type === 'serie'),
      animes: completedShows.filter((s) => s.type === 'anime'),
      movies: watchedMovies,
    },
  });
});

router.post('/import/tvtime', uploadArchive.single('archive'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier requis.' });
    const summary = await importTvTimeArchive(req.file.buffer, req.user.id);
    res.json(summary);
  } catch (e) { next(e); }
});

export default router;
