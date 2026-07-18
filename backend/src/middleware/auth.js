import { verifyToken } from '../utils/jwt.js';
import { db } from '../db/index.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Non authentifié.' });

  try {
    const payload = verifyToken(token);
    const user = db.prepare('SELECT id, username, email, role, status, avatar, language, discord_webhook_url FROM users WHERE id = ?')
      .get(payload.sub);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'Session invalide.' });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Session invalide.' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé à l\'administrateur.' });
  }
  next();
}
