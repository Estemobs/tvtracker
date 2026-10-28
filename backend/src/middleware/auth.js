import { verifyToken } from '../utils/jwt.js';
import { db } from '../db/index.js';
import { SESSION_COOKIE } from '../utils/cookies.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const bearer = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  const tokens = [req.cookies?.[SESSION_COOKIE], bearer].filter(Boolean);
  if (!tokens.length) return res.status(401).json({ error: 'Non authentifié.' });

  for (const token of tokens) {
    try {
      const payload = verifyToken(token);
      const user = db.prepare('SELECT id, username, email, role, status, avatar, language, discord_webhook_url, discord_message_template FROM users WHERE id = ?')
        .get(payload.sub);
      if (user && user.status === 'active') {
        req.user = user;
        return next();
      }
    } catch {
      // Try the next credential (e.g. a stale cookie must not shadow a valid Bearer token).
    }
  }
  return res.status(401).json({ error: 'Session invalide.' });
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé à l\'administrateur.' });
  }
  next();
}
