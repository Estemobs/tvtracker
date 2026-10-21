-- Search results are cached by provider + normalized query. Detail sheets live in `movies`
-- (keyed by IMDb id for Cinemeta) and are refreshed after several days; searches only a few hours.
CREATE TABLE IF NOT EXISTS movie_search_cache (
  provider TEXT NOT NULL,
  query TEXT NOT NULL,
  results_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, query)
);
