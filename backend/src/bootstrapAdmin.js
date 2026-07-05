import bcrypt from 'bcryptjs';
import { db } from './db/index.js';

export function bootstrapAdmin() {
  const { ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_USERNAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) return;

  const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?')
    .get(ADMIN_EMAIL, ADMIN_USERNAME);
  if (existing) return;

  const password_hash = bcrypt.hashSync(ADMIN_PASSWORD, 12);
  db.prepare(`INSERT INTO users (username, email, password_hash, role, status)
    VALUES (?, ?, ?, 'admin', 'active')`)
    .run(ADMIN_USERNAME, ADMIN_EMAIL, password_hash);
  console.log(`[bootstrap] admin account created for ${ADMIN_EMAIL}`);
}
