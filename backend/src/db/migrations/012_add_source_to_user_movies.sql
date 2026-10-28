-- Add source and source_id to user_movies to enable orphaned link repair after migrations
-- that rebuild the movies table with new IDs but preserve source+source_id.
--
-- SQLite does not allow ALTER TABLE ... ADD COLUMN with a PRIMARY KEY, so we do
-- not add an `id` column here: the existing (user_id, movie_id) primary key is
-- already used by every query.

ALTER TABLE user_movies ADD COLUMN source TEXT;
ALTER TABLE user_movies ADD COLUMN source_id TEXT;

-- Backfill from existing movies table (current state)
UPDATE user_movies
SET source = (SELECT source FROM movies WHERE movies.id = user_movies.movie_id),
    source_id = (SELECT source_id FROM movies WHERE movies.id = user_movies.movie_id);

-- For orphaned links (movie_id no longer exists), we can't backfill automatically
-- They will remain NULL and need manual intervention or title-based matching