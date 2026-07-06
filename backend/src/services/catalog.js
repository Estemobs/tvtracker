import { db } from '../db/index.js';
import * as tvmaze from './tvmaze.js';
import * as itunes from './itunes.js';
import * as wikipedia from './wikipedia.js';
import * as wikidata from './wikidata.js';

const STALE_MS = 24 * 60 * 60 * 1000; // refresh cached metadata after 1 day

export async function cacheShow(sourceId) {
  let show = db.prepare(`SELECT * FROM shows WHERE source = 'tvmaze' AND source_id = ?`).get(String(sourceId));
  const isStale = !show || Date.now() - new Date(show.updated_at + 'Z').getTime() > STALE_MS;

  if (isStale) {
    const details = await tvmaze.getShowDetails(sourceId);
    const upsert = db.prepare(`
      INSERT INTO shows (source, source_id, type, title, poster, backdrop, synopsis, note, genres, air_status, schedule_day, schedule_time, runtime, nb_seasons, nb_episodes, updated_at)
      VALUES ('tvmaze', @source_id, @type, @title, @poster, @backdrop, @synopsis, @note, @genres, @air_status, @schedule_day, @schedule_time, @runtime, @nb_seasons, @nb_episodes, datetime('now'))
      ON CONFLICT(source, source_id) DO UPDATE SET
        type=excluded.type, title=excluded.title, poster=excluded.poster, backdrop=excluded.backdrop,
        synopsis=excluded.synopsis, note=excluded.note, genres=excluded.genres, air_status=excluded.air_status,
        schedule_day=excluded.schedule_day, schedule_time=excluded.schedule_time, runtime=excluded.runtime,
        nb_seasons=excluded.nb_seasons, nb_episodes=excluded.nb_episodes, updated_at=datetime('now')
    `);
    upsert.run({ ...details, genres: JSON.stringify(details.genres) });
    show = db.prepare(`SELECT * FROM shows WHERE source = 'tvmaze' AND source_id = ?`).get(String(sourceId));

    const insertEp = db.prepare(`
      INSERT INTO episodes (show_id, season, episode_number, title, duration, air_date)
      VALUES (@show_id, @season, @episode_number, @title, @duration, @air_date)
      ON CONFLICT(show_id, season, episode_number) DO UPDATE SET
        title=excluded.title, duration=excluded.duration, air_date=excluded.air_date
    `);
    for (const ep of details.episodes) {
      insertEp.run({ show_id: show.id, ...ep });
    }
    db.prepare('UPDATE shows SET nb_episodes = ? WHERE id = ?').run(details.episodes.length, show.id);
    show = db.prepare(`SELECT * FROM shows WHERE source = 'tvmaze' AND source_id = ?`).get(String(sourceId));
  }

  return show;
}

// Wikidata cross-referencing: fills gaps the primary source (Wikipedia/iTunes) left empty —
// cast list, an IMDb-scale rating, and a poster (checking the Wikidata image claim, then
// falling back to the English Wikipedia article via its exact Wikidata sitelink — never a
// fuzzy title search, to avoid attaching an unrelated film's poster).
export async function enrichMovieWithWikidata(details) {
  const wikibaseItem = details.wikibase_item || await wikipedia.findWikibaseItem(details.title);
  if (!wikibaseItem) return { ...details, cast: [] };

  const { cast, rating } = await wikidata.getCastAndRating(wikibaseItem).catch(() => ({ cast: [], rating: null }));
  let poster = details.poster;
  if (!poster) {
    poster = await wikidata.getPoster(wikibaseItem).catch(() => null);
  }
  if (!poster) {
    const enTitle = await wikidata.getEnglishSitelink(wikibaseItem).catch(() => null);
    if (enTitle) {
      const en = await wikipedia.getEnglishSummaryByTitle(enTitle).catch(() => null);
      poster = en?.poster || null;
    }
  }

  return { ...details, poster, note: details.note ?? rating, cast };
}

export async function cacheMovie(source, sourceId) {
  let movie = db.prepare(`SELECT * FROM movies WHERE source = ? AND source_id = ?`).get(source, String(sourceId));
  const isStale = !movie || Date.now() - new Date(movie.updated_at + 'Z').getTime() > STALE_MS;

  if (isStale) {
    const baseDetails = source === 'itunes'
      ? await itunes.getMovieDetails(sourceId)
      : await wikipedia.getMovieSummary(sourceId);
    const details = await enrichMovieWithWikidata(baseDetails);

    const upsert = db.prepare(`
      INSERT INTO movies (source, source_id, title, poster, backdrop, synopsis, duration, note, genres, release_date, cast_json, updated_at)
      VALUES (@source, @source_id, @title, @poster, @backdrop, @synopsis, @duration, @note, @genres, @release_date, @cast_json, datetime('now'))
      ON CONFLICT(source, source_id) DO UPDATE SET
        title=excluded.title, poster=excluded.poster, backdrop=excluded.backdrop, synopsis=excluded.synopsis,
        duration=excluded.duration, note=excluded.note, genres=excluded.genres, release_date=excluded.release_date,
        cast_json=excluded.cast_json, updated_at=datetime('now')
    `);
    upsert.run({ ...details, genres: JSON.stringify(details.genres), cast_json: JSON.stringify(details.cast) });
    movie = db.prepare(`SELECT * FROM movies WHERE source = ? AND source_id = ?`).get(source, String(sourceId));
  }

  return movie;
}
