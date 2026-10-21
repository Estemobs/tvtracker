-- Movies become keyed by their IMDb id instead of a provider-specific id. SQLite can't alter a
-- CHECK constraint in place, so the table is rebuilt to allow the new 'cinemeta' source too.
-- defer_foreign_keys keeps user_movies' FK satisfied across the DROP/RENAME while the transaction
-- is open (it is checked once more at COMMIT, and all referenced ids are preserved).
PRAGMA defer_foreign_keys = ON;

CREATE TABLE movies_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'itunes' CHECK (source IN ('itunes', 'wikipedia', 'cinemeta')),
  source_id TEXT NOT NULL,
  imdb_id TEXT,
  title TEXT NOT NULL,
  poster TEXT,
  backdrop TEXT,
  synopsis TEXT,
  duration INTEGER,
  note REAL,
  genres TEXT,
  release_date TEXT,
  synopsis_fr TEXT,
  cast_json TEXT,
  platform TEXT,
  next_installment_json TEXT,
  jw_platforms TEXT,
  jw_score REAL,
  jw_url TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, source_id)
);

INSERT INTO movies_new (
  id, source, source_id, imdb_id, title, poster, backdrop, synopsis, duration, note, genres,
  release_date, synopsis_fr, cast_json, platform, next_installment_json, jw_platforms, jw_score,
  jw_url, updated_at
)
SELECT
  id, source, source_id, NULL, title, poster, backdrop, synopsis, duration, note, genres,
  release_date, synopsis_fr, cast_json, platform, next_installment_json, jw_platforms, jw_score,
  jw_url, updated_at
FROM movies;

DROP TABLE movies;
ALTER TABLE movies_new RENAME TO movies;

CREATE INDEX IF NOT EXISTS idx_movies_imdb_id ON movies(imdb_id);
