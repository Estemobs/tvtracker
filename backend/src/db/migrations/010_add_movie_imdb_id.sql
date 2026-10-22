-- Movies become keyed by their IMDb id instead of a provider-specific id. SQLite can't alter a
-- CHECK constraint in place, so the table is rebuilt to allow the new 'cinemeta' source too.
-- Note: defer_foreign_keys does NOT stop ON DELETE CASCADE from firing on the DROP TABLE below;
-- that is why user_movies is backed up and restored explicitly.
PRAGMA defer_foreign_keys = ON;

-- user_movies.movie_id is ON DELETE CASCADE. Dropping the old movies table below therefore fires
-- that cascade and silently deletes every user's saved films (ownership, watched status, ratings).
-- Keep a copy in a temp table and put it back after the rebuild. This is what the first version of
-- this migration missed; existing installs that already ran it need the recovery script, but any
-- database still on migration 009 must not lose its lists.
CREATE TEMP TABLE _user_movies_backup AS SELECT * FROM user_movies;

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

INSERT OR IGNORE INTO user_movies (user_id, movie_id, status, personal_rating, added_at, watched_at)
SELECT user_id, movie_id, status, personal_rating, added_at, watched_at
FROM _user_movies_backup;

DROP TABLE _user_movies_backup;
