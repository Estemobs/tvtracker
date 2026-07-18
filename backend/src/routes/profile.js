import { Router } from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { db, DATA_DIR } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { importTvTimeArchive } from '../services/tvtimeImport.js';
import {
  normalizeDiscordWebhookUrl,
  normalizeDiscordMessageTemplate,
  DEFAULT_MESSAGE_TEMPLATE,
  buildPayload,
  sendWebhook,
} from '../services/discordNotifications.js';

const router = Router();
router.use(requireAuth);

// The import runs for minutes (hundreds of external lookups) so the upload request can't just
// block until it's done — the browser/proxy would time out and the UI couldn't show progress.
// Kept in-memory only: this is a single-container self-hosted app, a lost job on restart just
// means re-uploading the same archive, which is idempotent (ON CONFLICT DO NOTHING/UPDATE throughout).
const importJobs = new Map();
const JOB_TTL_MS = 60 * 60 * 1000;

function pruneOldJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of importJobs) {
    if (job.finishedAt && job.finishedAt < cutoff) importJobs.delete(id);
  }
}

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
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'discord_webhook_url')) {
    try {
      updates.push('discord_webhook_url = ?');
      values.push(normalizeDiscordWebhookUrl(req.body.discord_webhook_url));
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'discord_message_template')) {
    try {
      updates.push('discord_message_template = ?');
      values.push(normalizeDiscordMessageTemplate(req.body.discord_message_template));
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
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

// Sends a real webhook call to Discord, so cap it hard enough to prevent someone from turning
// this into a free webhook-spamming relay while still allowing a handful of iterative retries.
const discordTestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user.id),
  message: { error: 'Trop de tests envoyés, réessaie dans quelques minutes.' },
});

router.post('/discord-webhook/test', discordTestLimiter, async (req, res) => {
  const body = req.body || {};
  let webhookUrl;
  try {
    webhookUrl = Object.prototype.hasOwnProperty.call(body, 'discord_webhook_url')
      ? normalizeDiscordWebhookUrl(body.discord_webhook_url)
      : req.user.discord_webhook_url;
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (!webhookUrl) return res.status(400).json({ error: 'Aucun lien de webhook Discord à tester.' });

  let messageTemplate;
  try {
    messageTemplate = Object.prototype.hasOwnProperty.call(body, 'discord_message_template')
      ? normalizeDiscordMessageTemplate(body.discord_message_template)
      : req.user.discord_message_template;
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const exampleEpisode = { season: 1, episode_number: 1, air_date: new Date().toISOString().slice(0, 10) };
  const payload = buildPayload('Ma Série (exemple)', exampleEpisode, null, messageTemplate);

  try {
    await sendWebhook(webhookUrl, payload);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
  res.json({ message: 'Notification de test envoyée sur Discord.' });
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

router.post('/import/tvtime', (req, res, next) => {
  uploadArchive.single('archive')(req, res, (err) => {
    // multer errors (file too large, wrong extension) never reach our route handler otherwise —
    // they'd fall through to the generic error middleware with an unhelpful English message.
    if (err) {
      console.error('[import/tvtime] upload rejected:', err);
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'Fichier trop volumineux (limite 100 Mo).'
        : err.message || 'Fichier invalide.';
      return res.status(status).json({ error: message });
    }
    next();
  });
}, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier requis.' });
  pruneOldJobs();

  const mem = process.memoryUsage();
  console.log(`[import/tvtime] starting for user ${req.user.id}, archive ${(req.file.size / 1024).toFixed(0)} Ko, heap ${(mem.heapUsed / 1024 / 1024).toFixed(0)}/${(mem.heapTotal / 1024 / 1024).toFixed(0)} Mo, rss ${(mem.rss / 1024 / 1024).toFixed(0)} Mo`);

  const jobId = randomUUID();
  const job = { status: 'running', progress: { done: 0, total: 0, phase: 'shows' }, result: null, error: null, finishedAt: null };
  importJobs.set(jobId, job);

  importTvTimeArchive(req.file.buffer, req.user.id, (progress) => { job.progress = progress; })
    .then((summary) => {
      job.status = 'done';
      job.result = summary;
      job.finishedAt = Date.now();
      console.log(`[import/tvtime] job ${jobId} done:`, summary);
    })
    .catch((e) => {
      // Not scrubbed: this is a single-admin self-hosted instance, and the raw message is far
      // more useful for diagnosing a failed import than a generic "something went wrong".
      console.error(`[import/tvtime] job ${jobId} failed:`, e);
      job.status = 'error';
      job.error = e.message || "Une erreur inattendue est survenue pendant l'import.";
      job.finishedAt = Date.now();
    });

  res.status(202).json({ job_id: jobId });
});

router.get('/import/tvtime/:jobId', (req, res) => {
  const job = importJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Import introuvable ou expiré.' });
  res.json({ status: job.status, progress: job.progress, result: job.result, error: job.error });
});

export default router;
