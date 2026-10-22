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

describe('migration 010 (movies keyed by IMDb id)', () => {
  it('preserves every user_movies row across the movies table rebuild', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvtracker-migration-'));
    const dbPath = path.join(dir, 'tvtracker.db');
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');

    try {
      for (const file of migrations.filter((name) => name < '010')) runMigration(db, file);

      db.prepare(`INSERT INTO users (username, email, password_hash, role, status)
        VALUES ('alice', 'alice@example.com', 'hash', 'user', 'active')`).run();
      db.prepare(`INSERT INTO users (username, email, password_hash, role, status)
        VALUES ('bob', 'bob@example.com', 'hash', 'user', 'active')`).run();
      db.prepare(`INSERT INTO movies (source, source_id, title) VALUES ('itunes', '1', 'Film 1')`).run();
      db.prepare(`INSERT INTO movies (source, source_id, title) VALUES ('itunes', '2', 'Film 2')`).run();

      db.prepare(`INSERT INTO user_movies
        (user_id, movie_id, status, personal_rating, added_at, watched_at)
        VALUES (1, 1, 'watched', 8.5, '2024-01-01 10:00:00', '2024-01-02 11:00:00')`).run();
      db.prepare(`INSERT INTO user_movies
        (user_id, movie_id, status, added_at)
        VALUES (1, 2, 'to_watch', '2024-02-01 12:00:00')`).run();
      db.prepare(`INSERT INTO user_movies
        (user_id, movie_id, status, added_at)
        VALUES (2, 2, 'to_watch', '2024-03-01 13:00:00')`).run();

      const before = db.prepare('SELECT * FROM user_movies ORDER BY user_id, movie_id').all();
      runMigration(db, '010_add_movie_imdb_id.sql');
      const after = db.prepare('SELECT * FROM user_movies ORDER BY user_id, movie_id').all();

      expect(after).toEqual(before);
      expect(after).toHaveLength(3);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
