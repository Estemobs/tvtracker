import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MIGRATIONS_DIR = path.join(process.cwd(), 'src', 'db', 'migrations');
const migrations = fs.readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort();

describe('migration chain 009 -> 012', () => {
  it('runs the real boot migrations without losing user_movies rows', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvtracker-chain-'));
    const raw = new Database(path.join(dir, 'tvtracker.db'));
    raw.pragma('foreign_keys = ON');

    raw.exec(`CREATE TABLE _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    for (const file of migrations.filter((name) => name < '010')) {
      raw.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
      raw.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
    }

    raw.prepare(`INSERT INTO users (username, email, password_hash, role, status)
      VALUES ('alice', 'alice@example.com', 'hash', 'user', 'active')`).run();
    raw.prepare(`INSERT INTO movies (source, source_id, title) VALUES ('itunes', '1', 'Film 1')`).run();
    raw.prepare(`INSERT INTO movies (source, source_id, title) VALUES ('itunes', '2', 'Film 2')`).run();
    raw.prepare(`INSERT INTO user_movies
      (user_id, movie_id, status, personal_rating, added_at, watched_at)
      VALUES (1, 1, 'watched', 8.5, '2024-01-01 10:00:00', '2024-01-02 11:00:00')`).run();
    raw.prepare(`INSERT INTO user_movies (user_id, movie_id, status, added_at)
      VALUES (1, 2, 'to_watch', '2024-02-01 12:00:00')`).run();
    raw.close();

    const previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = dir;
    vi.resetModules();
    const mod = await import('../src/db/index.js');

    try {
      const rows = mod.db.prepare('SELECT * FROM user_movies ORDER BY movie_id').all();
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ movie_id: 1, source: 'itunes', source_id: '1', personal_rating: 8.5 });
      expect(rows[1]).toMatchObject({ movie_id: 2, source: 'itunes', source_id: '2', status: 'to_watch' });

      const applied = mod.db.prepare('SELECT name FROM _migrations ORDER BY name').all().map((row) => row.name);
      expect(applied).toContain('010_add_movie_imdb_id.sql');
      expect(applied).toContain('012_add_source_to_user_movies.sql');
      expect(mod.db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      mod.db.close();
      if (previousDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previousDataDir;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
