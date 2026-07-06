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
      INSERT INTO shows (source, source_id, type, title, poster, backdrop, synopsis, note, genres, air_status, platform, schedule_day, schedule_time, runtime, next_episode_json, nb_seasons, nb_episodes, updated_at)
      VALUES ('tvmaze', @source_id, @type, @title, @poster, @backdrop, @synopsis, @note, @genres, @air_status, @platform, @schedule_day, @schedule_time, @runtime, @next_episode_json, @nb_seasons, @nb_episodes, datetime('now'))
      ON CONFLICT(source, source_id) DO UPDATE SET
        type=excluded.type, title=excluded.title, poster=excluded.poster, backdrop=excluded.backdrop,
        synopsis=excluded.synopsis, note=excluded.note, genres=excluded.genres, air_status=excluded.air_status,
        platform=excluded.platform, schedule_day=excluded.schedule_day, schedule_time=excluded.schedule_time, runtime=excluded.runtime,
        next_episode_json=excluded.next_episode_json, nb_seasons=excluded.nb_seasons, nb_episodes=excluded.nb_episodes, updated_at=datetime('now')
    `);
    upsert.run({ ...details, genres: JSON.stringify(details.genres), next_episode_json: JSON.stringify(details.next_episode) });
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
// cast list (with actor photos), a normalized rating, a platform mention, an upcoming sequel,
// and a poster (Wikidata's own image claim, then the English Wikipedia article via its exact
// Wikidata sitelink — never a fuzzy title search, to avoid attaching an unrelated film's poster).
export async function enrichMovieWithWikidata(details) {
  let wikibaseItem = details.wikibase_item;
  let platform = details.platform;

  if (!wikibaseItem) {
    const frenchArticle = await wikipedia.findFrenchArticle(details.title).catch(() => null);
    wikibaseItem = frenchArticle?.wikibase_item || null;
    platform = platform || frenchArticle?.platform || null;
  }
  if (!wikibaseItem) return { ...details, platform, cast: [] };

  const [{ cast, rating }, nextInstallment] = await Promise.all([
    wikidata.getCastAndRating(wikibaseItem).catch(() => ({ cast: [], rating: null })),
    wikidata.getNextInstallment(wikibaseItem).catch(() => null),
  ]);
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

  return {
    ...details,
    poster,
    platform,
    note: details.note ?? rating?.value ?? null,
    cast,
    next_installment: nextInstallment,
  };
}

export async function cacheMovie(source, sourceId) {
  let movie = db.prepare(`SELECT * FROM movies WHERE source = ? AND source_id = ?`).get(source, String(sourceId));
  // Treat a movie missing its poster or cast as stale regardless of age: an empty result more
  // often means a past fetch failed (rate limit, momentary network issue) than that the source
  // genuinely has nothing — worth retrying on the next view rather than sitting incomplete for a day.
  const isIncomplete = movie && (!movie.poster || movie.cast_json === '[]' || !movie.cast_json);
  const isStale = !movie || isIncomplete || Date.now() - new Date(movie.updated_at + 'Z').getTime() > STALE_MS;

  if (isStale) {
    const baseDetails = source === 'itunes'
      ? await itunes.getMovieDetails(sourceId)
      : await wikipedia.getMovieSummary(sourceId);
    const details = await enrichMovieWithWikidata(baseDetails);

    const upsert = db.prepare(`
      INSERT INTO movies (source, source_id, title, poster, backdrop, synopsis, duration, note, genres, release_date, platform, cast_json, next_installment_json, updated_at)
      VALUES (@source, @source_id, @title, @poster, @backdrop, @synopsis, @duration, @note, @genres, @release_date, @platform, @cast_json, @next_installment_json, datetime('now'))
      ON CONFLICT(source, source_id) DO UPDATE SET
        title=excluded.title, poster=excluded.poster, backdrop=excluded.backdrop, synopsis=excluded.synopsis,
        duration=excluded.duration, note=excluded.note, genres=excluded.genres, release_date=excluded.release_date,
        platform=excluded.platform, cast_json=excluded.cast_json, next_installment_json=excluded.next_installment_json,
        updated_at=datetime('now')
    `);
    upsert.run({
      ...details,
      platform: details.platform || null,
      genres: JSON.stringify(details.genres),
      cast_json: JSON.stringify(details.cast),
      next_installment_json: JSON.stringify(details.next_installment),
    });
    movie = db.prepare(`SELECT * FROM movies WHERE source = ? AND source_id = ?`).get(source, String(sourceId));
  }

  return movie;
}
