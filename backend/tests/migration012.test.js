import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MIGRATIONS_DIR = path.join(process.cwd(), 'src', 'db', 'migrations');
const migrations = fs.readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort();

function runMigration(db, file) {
  db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
}

describe('migration 012 (source columns on user_movies)', () => {
  it('adds source/source_id and keeps every user_movies row', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvtracker-migration-'));
    const dbPath = path.join(dir, 'tvtracker.db');
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');

    try {
      for (const file of migrations.filter((name) => name < '012')) runMigration(db, file);

      db.prepare(`INSERT INTO users (username, email, password_hash, role, status)
        VALUES ('alice', 'alice@example.com', 'hash', 'user', 'active')`).run();
      db.prepare(`INSERT INTO movies (source, source_id, title) VALUES ('itunes', '42', 'Film 42')`).run();
      db.prepare(`INSERT INTO user_movies
        (user_id, movie_id, status, personal_rating, added_at, watched_at)
        VALUES (1, 1, 'watched', 8.5, '2024-01-01 10:00:00', '2024-01-02 11:00:00')`).run();

      const before = db.prepare('SELECT * FROM user_movies').all();
      runMigration(db, '012_add_source_to_user_movies.sql');
      const after = db.prepare('SELECT * FROM user_movies').all();

      expect(after).toHaveLength(before.length);
      expect(after[0]).toMatchObject({
        user_id: 1,
        movie_id: 1,
        status: 'watched',
        personal_rating: 8.5,
        source: 'itunes',
        source_id: '42'
      });
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
