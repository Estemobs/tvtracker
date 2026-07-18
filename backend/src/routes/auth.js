import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { db } from '../db/index.js';
import { signToken } from '../utils/jwt.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez plus tard.' },
});

// Registration is a public, unauthenticated endpoint that writes to the DB — rate-limit harder
// than login to prevent mass fake-account creation (per cahier des charges admin validation flow).
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de demandes d\'inscription depuis cette adresse, réessayez plus tard.' },
});

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const SUCCESS_MESSAGE = 'Votre compte doit être approuvé par un administrateur avant de pouvoir vous connecter.';

router.post('/register', registerLimiter, (req, res) => {
  const { username, email, password, confirmPassword, website } = req.body || {};

  // Honeypot: a hidden field real users never fill in, but bots blindly fill every input.
  // Pretend success without creating anything, so scripted spam can't tell it was rejected.
  if (website) {
    return res.status(201).json({ message: SUCCESS_MESSAGE });
  }

  if (!username || !email || !password || !confirmPassword) {
    return res.status(400).json({ error: 'Tous les champs sont requis.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'E-mail invalide.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Les mots de passe ne correspondent pas.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
  if (existing) {
    return res.status(409).json({ error: 'Un compte existe déjà avec cet e-mail ou ce nom d\'utilisateur.' });
  }

  const password_hash = bcrypt.hashSync(password, 12);
  const info = db.prepare(`INSERT INTO users (username, email, password_hash, role, status)
    VALUES (?, ?, ?, 'user', 'pending')`).run(username, email, password_hash);

  res.status(201).json({
    id: info.lastInsertRowid,
    message: SUCCESS_MESSAGE,
  });
});

router.post('/login', loginLimiter, (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?').get(identifier, identifier);
  if (!user) {
    return res.status(401).json({ error: 'Identifiants invalides.' });
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return res.status(423).json({ error: 'Compte temporairement verrouillé suite à plusieurs échecs. Réessayez plus tard.' });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    const attempts = user.failed_login_attempts + 1;
    const lockedUntil = attempts >= 5
      ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
      : null;
    db.prepare('UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?')
      .run(attempts, lockedUntil, user.id);
    return res.status(401).json({ error: 'Identifiants invalides.' });
  }

  if (user.status === 'pending') {
    return res.status(403).json({ error: 'Votre compte est en attente de validation par un administrateur.' });
  }
  if (user.status === 'refused') {
    return res.status(403).json({ error: 'Votre inscription a été refusée.' });
  }
  if (user.status === 'disabled') {
    return res.status(403).json({ error: 'Votre compte a été désactivé.' });
  }

  db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);

  const token = signToken(user);
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      language: user.language,
      discord_webhook_url: user.discord_webhook_url,
    },
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
