import { db } from '../db/index.js';
import * as tvmaze from './tvmaze.js';
import * as itunes from './itunes.js';
import * as wikipedia from './wikipedia.js';
import * as wikidata from './wikidata.js';
import * as justwatch from './justwatch.js';

const STALE_MS = 24 * 60 * 60 * 1000; // refresh cached metadata after 1 day

// TVmaze/Wikipedia only ever give one platform mention at best, buried in prose, and neither has
// a rating — JustWatch has both (real per-platform availability, an IMDb/TMDB-backed score) plus
// its own page as a "more info" link. Non-fatal: an unofficial API glitching shouldn't break the
// TVmaze/Wikipedia data that's actually load-bearing for the rest of the page.
async function findJustWatchInfo(title, objectType) {
  try {
    return await justwatch.findByTitle(title, objectType);
  } catch {
    return null;
  }
}

export async function cacheShow(sourceId) {
  let show = db.prepare(`SELECT * FROM shows WHERE source = 'tvmaze' AND source_id = ?`).get(String(sourceId));
  // Same self-healing logic as movies (see cacheMovie below): treat a show missing its poster,
  // backdrop or JustWatch info as stale regardless of age, so shows cached before those fields
  // existed pick them up the next time this runs, instead of staying incomplete for up to a day.
  const isIncomplete = show && (!show.poster || !show.backdrop || !show.jw_url);
  const isStale = !show || isIncomplete || Date.now() - new Date(show.updated_at + 'Z').getTime() > STALE_MS;

  if (isStale) {
    const details = await tvmaze.getShowDetails(sourceId);
    const jw = await findJustWatchInfo(details.title, 'SHOW');
    const upsert = db.prepare(`
      INSERT INTO shows (source, source_id, type, title, poster, backdrop, synopsis, note, genres, air_status, platform, schedule_day, schedule_time, runtime, next_episode_json, nb_seasons, nb_episodes, jw_platforms, jw_score, jw_url, updated_at)
      VALUES ('tvmaze', @source_id, @type, @title, @poster, @backdrop, @synopsis, @note, @genres, @air_status, @platform, @schedule_day, @schedule_time, @runtime, @next_episode_json, @nb_seasons, @nb_episodes, @jw_platforms, @jw_score, @jw_url, datetime('now'))
      ON CONFLICT(source, source_id) DO UPDATE SET
        type=excluded.type, title=excluded.title, poster=excluded.poster, backdrop=excluded.backdrop,
        synopsis=excluded.synopsis, note=excluded.note, genres=excluded.genres, air_status=excluded.air_status,
        platform=excluded.platform, schedule_day=excluded.schedule_day, schedule_time=excluded.schedule_time, runtime=excluded.runtime,
        next_episode_json=excluded.next_episode_json, nb_seasons=excluded.nb_seasons, nb_episodes=excluded.nb_episodes,
        jw_platforms=excluded.jw_platforms, jw_score=excluded.jw_score, jw_url=excluded.jw_url, updated_at=datetime('now')
    `);
    upsert.run({
      ...details,
      genres: JSON.stringify(details.genres),
      next_episode_json: JSON.stringify(details.next_episode),
      jw_platforms: JSON.stringify(jw?.platforms || []),
      jw_score: jw?.score ?? null,
      jw_url: jw?.url ?? null,
    });
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
//
// `posterOnly` is used by the bulk TV Time import: cross-referencing cast/rating/next-installment
// for hundreds of movies in one go made the import far slower for the least visible payoff — but
// skipping the poster fallback chain too meant imported movies kept showing no image at all
// forever (nothing else ever re-visits an already-cached movie to retry it). So the import still
// resolves the poster properly; only cast/rating/sequel are deferred to the first real page view.
export async function enrichMovieWithWikidata(details, { posterOnly = false } = {}) {
  let wikibaseItem = details.wikibase_item;
  let platform = details.platform;

  if (!wikibaseItem) {
    const frenchArticle = await wikipedia.findFrenchArticle(details.title).catch(() => null);
    wikibaseItem = frenchArticle?.wikibase_item || null;
    platform = platform || frenchArticle?.platform || null;
  }
  if (!wikibaseItem) return { ...details, platform, cast: [] };

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

  // Wikidata/English-wiki fallback only ever resolves a poster, never a distinct backdrop —
  // if the base source had neither (poster was empty until just now), reuse it as the backdrop too.
  const backdrop = details.backdrop || poster;

  if (posterOnly) {
    return { ...details, poster, backdrop, platform, cast: [] };
  }

  const [{ cast, rating }, nextInstallment] = await Promise.all([
    wikidata.getCastAndRating(wikibaseItem).catch(() => ({ cast: [], rating: null })),
    wikidata.getNextInstallment(wikibaseItem).catch(() => null),
  ]);

  return {
    ...details,
    poster,
    backdrop,
    platform,
    note: details.note ?? rating?.value ?? null,
    cast,
    next_installment: nextInstallment,
  };
}

export async function cacheMovie(source, sourceId, { posterOnly = false } = {}) {
  let movie = db.prepare(`SELECT * FROM movies WHERE source = ? AND source_id = ?`).get(source, String(sourceId));
  // Treat a movie missing its poster, cast or duration as stale regardless of age: an empty
  // result more often means a past fetch failed (rate limit, momentary network issue, or — for
  // duration specifically — a movie added via the Wikipedia source, which never reports one on
  // its own, see below) than that the source genuinely has nothing, so it's worth retrying on
  // the next view rather than sitting incomplete forever (a NULL duration would otherwise make
  // this movie silently drop out of any total-watch-time stat for good).
  const isIncomplete = movie && (!movie.poster || !movie.backdrop || movie.cast_json === '[]' || !movie.cast_json || !movie.duration);
  const isStale = !movie || isIncomplete || Date.now() - new Date(movie.updated_at + 'Z').getTime() > STALE_MS;

  if (isStale) {
    const baseDetails = source === 'itunes'
      ? await itunes.getMovieDetails(sourceId)
      : await wikipedia.getMovieSummary(sourceId);
    const details = await enrichMovieWithWikidata(baseDetails, { posterOnly });
    // Fetched even when posterOnly: unlike the Wikidata cast/rating/next-installment calls that
    // flag skips (each its own rate-limit-prone round trip — see movies.js's poster-healing loop
    // comment), JustWatch has been reliable and cheap (one call) throughout, and it's also the
    // only source of duration for a Wikipedia-sourced movie — skipping it here would mean a movie
    // healed through this path keeps a NULL duration until someone happens to open its detail page.
    const jw = await findJustWatchInfo(details.title, 'MOVIE');
    // Wikipedia's own summary never reports a runtime (see getMovieSummary) — JustWatch's does,
    // so it's the only fallback available for anything not sourced from iTunes.
    if (!details.duration && jw?.runtime) details.duration = jw.runtime;

    const upsert = db.prepare(`
      INSERT INTO movies (source, source_id, title, poster, backdrop, synopsis, duration, note, genres, release_date, platform, cast_json, next_installment_json, jw_platforms, jw_score, jw_url, updated_at)
      VALUES (@source, @source_id, @title, @poster, @backdrop, @synopsis, @duration, @note, @genres, @release_date, @platform, @cast_json, @next_installment_json, @jw_platforms, @jw_score, @jw_url, datetime('now'))
      ON CONFLICT(source, source_id) DO UPDATE SET
        title=excluded.title, poster=excluded.poster, backdrop=excluded.backdrop, synopsis=excluded.synopsis,
        duration=excluded.duration, note=excluded.note, genres=excluded.genres, release_date=excluded.release_date,
        platform=excluded.platform, cast_json=excluded.cast_json, next_installment_json=excluded.next_installment_json,
        jw_platforms=excluded.jw_platforms, jw_score=excluded.jw_score, jw_url=excluded.jw_url, updated_at=datetime('now')
    `);
    upsert.run({
      ...details,
      platform: details.platform || null,
      genres: JSON.stringify(details.genres),
      cast_json: JSON.stringify(details.cast),
      next_installment_json: JSON.stringify(details.next_installment),
      jw_platforms: JSON.stringify(jw?.platforms || []),
      jw_score: jw?.score ?? null,
      jw_url: jw?.url ?? null,
    });
    movie = db.prepare(`SELECT * FROM movies WHERE source = ? AND source_id = ?`).get(source, String(sourceId));
  }

  return movie;
}
