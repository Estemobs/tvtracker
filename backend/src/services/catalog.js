import { db } from '../db/index.js';
import * as tmdb from './tmdb.js';

const STALE_MS = 24 * 60 * 60 * 1000; // refresh cached metadata after 1 day

export async function cacheShow(tmdbId) {
  let show = db.prepare('SELECT * FROM shows WHERE tmdb_id = ?').get(tmdbId);
  const isStale = !show || Date.now() - new Date(show.updated_at + 'Z').getTime() > STALE_MS;

  if (isStale) {
    const details = await tmdb.getTvDetails(tmdbId);
    const upsert = db.prepare(`
      INSERT INTO shows (tmdb_id, type, title, poster, backdrop, synopsis, note, genres, air_status, nb_seasons, nb_episodes, updated_at)
      VALUES (@tmdb_id, @type, @title, @poster, @backdrop, @synopsis, @note, @genres, @air_status, @nb_seasons, @nb_episodes, datetime('now'))
      ON CONFLICT(tmdb_id) DO UPDATE SET
        type=excluded.type, title=excluded.title, poster=excluded.poster, backdrop=excluded.backdrop,
        synopsis=excluded.synopsis, note=excluded.note, genres=excluded.genres, air_status=excluded.air_status,
        nb_seasons=excluded.nb_seasons, nb_episodes=excluded.nb_episodes, updated_at=datetime('now')
    `);
    upsert.run({ ...details, genres: JSON.stringify(details.genres) });
    show = db.prepare('SELECT * FROM shows WHERE tmdb_id = ?').get(tmdbId);

    let episodeCount = 0;
    for (const season of details.seasons) {
      const seasonData = await tmdb.getSeasonDetails(tmdbId, season.season_number);
      const insertEp = db.prepare(`
        INSERT INTO episodes (show_id, season, episode_number, title, duration, air_date)
        VALUES (@show_id, @season, @episode_number, @title, @duration, @air_date)
        ON CONFLICT(show_id, season, episode_number) DO UPDATE SET
          title=excluded.title, duration=excluded.duration, air_date=excluded.air_date
      `);
      for (const ep of seasonData.episodes) {
        insertEp.run({ show_id: show.id, season: seasonData.season, ...ep });
        episodeCount++;
      }
    }
    db.prepare('UPDATE shows SET nb_episodes = ? WHERE id = ?').run(episodeCount, show.id);
    show = db.prepare('SELECT * FROM shows WHERE tmdb_id = ?').get(tmdbId);
  }

  return show;
}

export async function cacheMovie(tmdbId) {
  let movie = db.prepare('SELECT * FROM movies WHERE tmdb_id = ?').get(tmdbId);
  const isStale = !movie || Date.now() - new Date(movie.updated_at + 'Z').getTime() > STALE_MS;

  if (isStale) {
    const details = await tmdb.getMovieDetails(tmdbId);
    const upsert = db.prepare(`
      INSERT INTO movies (tmdb_id, title, poster, backdrop, synopsis, duration, note, genres, release_date, updated_at)
      VALUES (@tmdb_id, @title, @poster, @backdrop, @synopsis, @duration, @note, @genres, @release_date, datetime('now'))
      ON CONFLICT(tmdb_id) DO UPDATE SET
        title=excluded.title, poster=excluded.poster, backdrop=excluded.backdrop, synopsis=excluded.synopsis,
        duration=excluded.duration, note=excluded.note, genres=excluded.genres, release_date=excluded.release_date,
        updated_at=datetime('now')
    `);
    upsert.run({ ...details, genres: JSON.stringify(details.genres) });
    movie = db.prepare('SELECT * FROM movies WHERE tmdb_id = ?').get(tmdbId);
  }

  return movie;
}
