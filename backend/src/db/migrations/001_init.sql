CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled', 'refused')),
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'tvmaze',
  source_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'serie' CHECK (type IN ('serie', 'anime')),
  title TEXT NOT NULL,
  poster TEXT,
  backdrop TEXT,
  synopsis TEXT,
  note REAL,
  genres TEXT,
  air_status TEXT,
  nb_seasons INTEGER NOT NULL DEFAULT 0,
  nb_episodes INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, source_id)
);

CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  episode_number INTEGER NOT NULL,
  title TEXT,
  duration INTEGER,
  air_date TEXT,
  UNIQUE(show_id, season, episode_number)
);

CREATE TABLE IF NOT EXISTS movies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'itunes' CHECK (source IN ('itunes', 'wikipedia')),
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  poster TEXT,
  backdrop TEXT,
  synopsis TEXT,
  duration INTEGER,
  note REAL,
  genres TEXT,
  release_date TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, source_id)
);

CREATE TABLE IF NOT EXISTS user_shows (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  personal_rating REAL,
  personal_review TEXT,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, show_id)
);

CREATE TABLE IF NOT EXISTS user_episodes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  watched INTEGER NOT NULL DEFAULT 0,
  watched_at TEXT,
  PRIMARY KEY (user_id, episode_id)
);

CREATE TABLE IF NOT EXISTS user_movies (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'to_watch' CHECK (status IN ('to_watch', 'watched')),
  personal_rating REAL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  watched_at TEXT,
  PRIMARY KEY (user_id, movie_id)
);

CREATE INDEX IF NOT EXISTS idx_episodes_show ON episodes(show_id);
CREATE INDEX IF NOT EXISTS idx_user_episodes_user ON user_episodes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_shows_user ON user_shows(user_id);
CREATE INDEX IF NOT EXISTS idx_user_movies_user ON user_movies(user_id);
