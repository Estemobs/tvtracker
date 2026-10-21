import { db } from '../db/index.js';
import * as tvmaze from './tvmaze.js';
import * as itunes from './itunes.js';
import * as cinemeta from './cinemeta.js';
import * as wikipedia from './wikipedia.js';
import * as wikidata from './wikidata.js';
import * as justwatch from './justwatch.js';
import * as tmdb from './tmdb.js';
import { normalizeTitle, pickRepairMatch, yearOf } from './movieMatch.js';
import { log as debugLog } from './debugLog.js';

const STALE_MS = 24 * 60 * 60 * 1000; // refresh cached show metadata after 1 day
// Movie sheets change even less often than show schedules, and Cinemeta is an unofficial add-on
// whose data we'd rather not re-request on every detail view.
const MOVIE_STALE_MS = 7 * 24 * 60 * 60 * 1000;
// A search result grid is cheap to re-query but still not worth hammering Cinemeta/iTunes for
// every keystroke someone commits; a few hours keeps it fresh without making the cache useless.
const SEARCH_TTL_MS = 3 * 60 * 60 * 1000;

// cinemeta is the default; wikipedia remains an explicit opt-out for the migration test week.
export function movieProvider() {
  return String(process.env.MOVIE_PROVIDER || '').toLowerCase() === 'wikipedia' ? 'wikipedia' : 'cinemeta';
}

// Exact (accent/case-insensitive) match first, then whichever result the source ranked first.
// This is the same rule the old Wikipedia path used to avoid attaching an unrelated film that
// merely shared a word with the query.
function pickBestMatch(candidates, query) {
  if (!candidates.length) return null;
  const target = normalizeTitle(query);
  return candidates.find((c) => normalizeTitle(c.title) === target) || candidates[0];
}

function searchCacheKey(query) {
  return String(query || '').trim().toLowerCase();
}

// A best-effort enrichment must never make a detail page feel stuck. Race it against a short
// deadline; the underlying request still settles in the background, but the page moves on.
async function withTimeout(promise, ms, fallback = null) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function readSearchCache(provider, query) {
  const row = db.prepare('SELECT results_json, updated_at FROM movie_search_cache WHERE provider = ? AND query = ?')
    .get(provider, searchCacheKey(query));
  if (!row) return null;
  if (Date.now() - new Date(row.updated_at + 'Z').getTime() > SEARCH_TTL_MS) return null;
  try {
    const parsed = JSON.parse(row.results_json);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeSearchCache(provider, query, results) {
  if (!results.length) return;
  db.prepare(`
    INSERT INTO movie_search_cache (provider, query, results_json, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(provider, query) DO UPDATE SET
      results_json = excluded.results_json, updated_at = datetime('now')
  `).run(provider, searchCacheKey(query), JSON.stringify(results));
}

// Provider-aware movie search. Cinemeta is primary; an empty/failed Cinemeta search falls back
// to iTunes (French storefront) so the Explorer search box never simply dies with the unofficial
// source. The result shape is identical for both, so callers don't need to know which one ran.
export async function searchMovies(query) {
  const term = String(query || '').trim();
  if (!term) return [];
  const provider = movieProvider();

  const cached = readSearchCache(provider, term);
  if (cached) return cached;

  if (provider === 'wikipedia') {
    const results = await wikipedia.searchMoviesAnyLanguage(term);
    writeSearchCache(provider, term, results);
    return results;
  }

  let results = [];
  try {
    results = await cinemeta.searchMovies(term);
  } catch (error) {
    debugLog('movies', `Recherche Cinemeta « ${term} » échouée (${error.message}) — repli iTunes.`);
  }
  if (!results.length) {
    results = await itunes.searchMovies(term).catch(() => []);
    debugLog('movies', `Recherche « ${term} » : ${results.length} résultat(s) de repli iTunes.`);
  }
  writeSearchCache(provider, term, results);
  return results;
}

export async function findMovieBestMatch(query) {
  if (movieProvider() === 'wikipedia') return wikipedia.findMovieBestMatch(query);
  return pickBestMatch(await searchMovies(query), query);
}

// Cinemeta/iTunes/Wikipedia only ever give a best-effort rating/platform mention, and JustWatch
// has both (real per-platform availability, an IMDb/TMDB-backed score) plus its own page as a
// "more info" link. Non-fatal: an unofficial API glitching shouldn't break the catalogue data
// that's actually load-bearing for the rest of the page.
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

// Wikidata cross-referencing: fills gaps the primary source (Cinemeta/iTunes/Wikipedia) left empty —
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
  const baseCast = Array.isArray(details.cast) ? details.cast : [];

  let poster = details.poster;
  // TMDB has the best poster coverage of any free source — try it before the Wikidata/Wikipedia
  // chain so a film whose source lacks a poster still gets one. Driving everything through
  // details.title means it works even when there's no Wikidata item. (When no TMDB_API_KEY is
  // configured findPoster just returns null immediately, so no need to gate here.)
  if (!poster) {
    poster = await tmdb.findPoster(details.title, { year: details.release_date?.slice(0, 4) }).catch(() => null);
  }

  // Cinemeta already hands us an IMDb id, and Wikidata's P345 property turns that into the exact
  // item — no fuzzy title search, which is both faster and immune to same-name films.
  if (!wikibaseItem && details.imdb_id) {
    wikibaseItem = await wikidata.findByImdbId(details.imdb_id).catch(() => null);
  }
  // Legacy provider rows (Wikipedia/iTunes) have no IMDb id; keep their old resolution path.
  if (!wikibaseItem && details.title) {
    const frenchArticle = await wikipedia.findFrenchArticle(details.title).catch(() => null);
    wikibaseItem = frenchArticle?.wikibase_item || null;
    platform = platform || frenchArticle?.platform || null;
  }
  if (!wikibaseItem) {
    return { ...details, poster, backdrop: details.backdrop || poster, platform, cast: baseCast };
  }

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
    return { ...details, poster, backdrop, platform, cast: baseCast };
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
    // Wikidata's cast has photos/person ids; Cinemeta's names-only list is a fine fallback when
    // the film has no Wikidata item or its P161 statements are empty.
    cast: cast.length ? cast : baseCast,
    next_installment: nextInstallment,
  };
}

async function fetchMovieDetails(source, sourceId) {
  if (source === 'cinemeta') return cinemeta.getMovie(sourceId);
  if (source === 'itunes') return itunes.getMovieDetails(sourceId);
  if (source === 'wikipedia') return wikipedia.getMovieSummary(sourceId);
  const err = new Error('Source de film inconnue.');
  err.status = 400;
  throw err;
}

// Only an exact, unambiguous title/year match is trusted here — the same rule as the one-off
// backfill script. Used to give an iTunes-fallback movie an IMDb id even though iTunes doesn't
// expose one, so the cache keeps converging on IMDb as its canonical key.
async function resolveImdbId(title, year) {
  const candidates = await cinemeta.searchMovies(title).catch(() => []);
  const target = normalizeTitle(title);
  const exact = candidates.filter((c) => normalizeTitle(c.title) === target);
  const match = year
    ? exact.find((c) => c.year === String(year))
    : (exact.length === 1 ? exact[0] : null);
  return match?.source_id || null;
}

export async function cacheMovie(source, sourceId, { posterOnly = false } = {}) {
  let movie = db.prepare(`SELECT * FROM movies WHERE source = ? AND source_id = ?`).get(source, String(sourceId));
  // Treat a movie missing its poster, cast, duration or release date as stale regardless of age:
  // an empty result more often means a past fetch failed (rate limit, momentary network issue,
  // or — for legacy Wikipedia rows — a source that barely reports duration/release date) than
  // that the source genuinely has nothing, so it's worth retrying rather than sitting incomplete
  // forever (a NULL duration would otherwise silently drop out of total-watch-time stats).
  // Cinemeta is allowed to have an empty cast without being considered broken; otherwise a film
  // with no listed cast would be re-fetched on every single view instead of staying cached.
  const castMissing = !movie?.cast_json || (movie.cast_json === '[]' && source !== 'cinemeta');
  const isIncomplete = movie && (!movie.poster || !movie.backdrop || castMissing || !movie.duration || !movie.release_date);
  const maxAge = source === 'cinemeta' ? MOVIE_STALE_MS : STALE_MS;
  const isStale = !movie || isIncomplete || Date.now() - new Date(movie.updated_at + 'Z').getTime() > maxAge;

  if (isStale) {
    const baseDetails = await fetchMovieDetails(source, sourceId);
    const details = await enrichMovieWithWikidata(baseDetails, { posterOnly });
    const originalTitle = details.title;

    // Cinemeta's titles are English; the iTunes French storefront sometimes knows the localized
    // title. This is a best-effort detail-page improvement, never a reason to fail the fetch.
    if (source === 'cinemeta' && details.title) {
      const localized = await withTimeout(itunes.findLocalizedTitle(details.title, {
        year: details.release_date?.slice(0, 4),
      }).catch(() => null), 4000);
      if (localized) details.title = localized;
    }

    if (!details.imdb_id && details.title) {
      details.imdb_id = await resolveImdbId(details.title, details.release_date?.slice(0, 4));
    }

    // Fetched even when posterOnly: unlike the Wikidata cast/rating/next-installment calls that
    // flag skips (each its own rate-limit-prone round trip — see movies.js's poster-healing loop
    // comment), JustWatch has been reliable and cheap (one call) throughout, and it's also a
    // useful source of duration/platform info when the primary source lacks one.
    let jw = await findJustWatchInfo(details.title, 'MOVIE');
    // A localized title can miss JustWatch's own title; retry with the source title before
    // giving up on platform/score information.
    if (!jw && originalTitle && originalTitle !== details.title) {
      jw = await findJustWatchInfo(originalTitle, 'MOVIE');
    }
    if (!details.duration && jw?.runtime) details.duration = jw.runtime;
    // JustWatch's release date is precise (unlike the year-only fallback some legacy sources
    // give), so it wins whenever it's there.
    if (jw?.releaseDate) details.release_date = jw.releaseDate;

    const upsert = db.prepare(`
      INSERT INTO movies (source, source_id, imdb_id, title, poster, backdrop, synopsis, duration, note, genres, release_date, platform, cast_json, next_installment_json, jw_platforms, jw_score, jw_url, updated_at)
      VALUES (@source, @source_id, @imdb_id, @title, @poster, @backdrop, @synopsis, @duration, @note, @genres, @release_date, @platform, @cast_json, @next_installment_json, @jw_platforms, @jw_score, @jw_url, datetime('now'))
      ON CONFLICT(source, source_id) DO UPDATE SET
        imdb_id=COALESCE(excluded.imdb_id, movies.imdb_id),
        title=CASE WHEN excluded.title != '' THEN excluded.title ELSE movies.title END,
        poster=COALESCE(excluded.poster, movies.poster),
        backdrop=COALESCE(excluded.backdrop, movies.backdrop),
        synopsis=CASE WHEN excluded.synopsis != '' THEN excluded.synopsis ELSE movies.synopsis END,
        duration=COALESCE(excluded.duration, movies.duration),
        note=COALESCE(excluded.note, movies.note),
        genres=CASE WHEN excluded.genres NOT IN ('', '[]') THEN excluded.genres ELSE movies.genres END,
        release_date=COALESCE(excluded.release_date, movies.release_date),
        platform=COALESCE(excluded.platform, movies.platform),
        cast_json=CASE WHEN excluded.cast_json NOT IN ('', '[]') THEN excluded.cast_json ELSE movies.cast_json END,
        next_installment_json=CASE WHEN excluded.next_installment_json NOT IN ('', 'null') THEN excluded.next_installment_json ELSE movies.next_installment_json END,
        jw_platforms=CASE WHEN excluded.jw_platforms NOT IN ('', '[]') THEN excluded.jw_platforms ELSE movies.jw_platforms END,
        jw_score=COALESCE(excluded.jw_score, movies.jw_score),
        jw_url=COALESCE(excluded.jw_url, movies.jw_url),
        updated_at=datetime('now')
    `);
    upsert.run({
      ...details,
      source,
      source_id: String(sourceId),
      imdb_id: details.imdb_id || (source === 'cinemeta' ? String(sourceId) : null),
      platform: details.platform || null,
      genres: JSON.stringify(details.genres || []),
      cast_json: JSON.stringify(details.cast || []),
      next_installment_json: JSON.stringify(details.next_installment ?? null),
      jw_platforms: JSON.stringify(jw?.platforms || []),
      jw_score: jw?.score ?? null,
      jw_url: jw?.url ?? null,
    });
    movie = db.prepare(`SELECT * FROM movies WHERE source = ? AND source_id = ?`).get(source, String(sourceId));
  }

  return movie;
}

// Cinemeta is the best source for a missing/expired poster, but an old row's title may be
// localized. `pickRepairMatch` (above) decides whether a title search is trustworthy enough to use.
async function findCinemetaPoster(row) {
  let imdbId = /^tt\d+$/.test(row.imdb_id || '') ? row.imdb_id : null;
  let match = null;

  if (!imdbId) {
    const candidates = await cinemeta.searchMovies(row.title).catch(() => []);
    match = pickRepairMatch(candidates, row.title, yearOf(row.release_date));
    imdbId = match?.source_id || null;
  }
  if (!imdbId) return null;

  const details = await cinemeta.getMovie(imdbId).catch(() => null);
  const poster = details?.poster || match?.poster || null;
  if (!poster) return null;
  return {
    imdb_id: imdbId,
    poster,
    backdrop: details?.backdrop || null,
    duration: details?.duration ?? null,
    release_date: details?.release_date || null,
  };
}

// Last resort for rows Cinemeta can't identify: TMDB (localized titles), then Wikidata via the
// exact French Wikipedia article, then the English Wikipedia article's lead image.
async function findFallbackPoster(row) {
  const year = yearOf(row.release_date);
  const tmdbPoster = await tmdb.findPoster(row.title, { year }).catch(() => null);
  if (tmdbPoster) return tmdbPoster;

  let wikibaseItem = /^tt\d+$/.test(row.imdb_id || '')
    ? await wikidata.findByImdbId(row.imdb_id).catch(() => null)
    : null;
  if (!wikibaseItem) {
    const frenchArticle = await wikipedia.findFrenchArticle(row.title).catch(() => null);
    wikibaseItem = frenchArticle?.wikibase_item || null;
  }
  if (!wikibaseItem) return null;

  const wikidataPoster = await wikidata.getPoster(wikibaseItem).catch(() => null);
  if (wikidataPoster) return wikidataPoster;

  const enTitle = await wikidata.getEnglishSitelink(wikibaseItem).catch(() => null);
  if (!enTitle) return null;
  const englishArticle = await wikipedia.getEnglishSummaryByTitle(enTitle).catch(() => null);
  return englishArticle?.poster || null;
}

// Repairs one movie in place, regardless of which provider originally cached it. `cacheMovie`
// already handles the normal case; this adds the cross-provider fallbacks that legacy rows need
// when their old iTunes/Wikipedia source no longer answers (a removed storefront id, a renamed
// article, ...). Returns true when a column actually changed.
export async function repairMovie(row) {
  const source = row.source;
  const sourceId = String(row.source_id);
  let current = db.prepare(`SELECT * FROM movies WHERE source = ? AND source_id = ?`).get(source, sourceId);
  if (!current) return false;

  const before = current;
  // Cinemeta rows don't need a full cache refresh: findCinemetaPoster below already fetches the
  // same detail sheet and, unlike cacheMovie's posterOnly mode, doesn't replace an enriched cast
  // with Cinemeta's names-only list. Legacy rows still get their own provider tried first.
  if (source !== 'cinemeta' && (!current.poster || !current.duration || !current.release_date)) {
    await cacheMovie(source, sourceId, { posterOnly: true }).catch(() => {});
    current = db.prepare(`SELECT * FROM movies WHERE source = ? AND source_id = ?`).get(source, sourceId) || current;
  }
  let changed = current.poster !== before.poster || current.backdrop !== before.backdrop
    || current.imdb_id !== before.imdb_id || current.duration !== before.duration
    || current.release_date !== before.release_date;

  let { poster, backdrop, imdb_id: imdbId, duration, release_date: releaseDate } = current;

  if (!poster || !backdrop || !duration || !releaseDate) {
    const cine = await findCinemetaPoster(current).catch(() => null);
    if (cine) {
      poster = poster || cine.poster;
      backdrop = backdrop || cine.backdrop || cine.poster;
      imdbId = imdbId || cine.imdb_id;
      duration = duration ?? cine.duration;
      releaseDate = releaseDate || cine.release_date;
    }
  }

  if (!poster) {
    const fallbackPoster = await findFallbackPoster(current).catch(() => null);
    if (fallbackPoster) {
      poster = fallbackPoster;
      backdrop = backdrop || fallbackPoster;
    }
  }

  if (poster === current.poster && backdrop === current.backdrop && imdbId === current.imdb_id
    && duration === current.duration && releaseDate === current.release_date) {
    return changed;
  }

  db.prepare(`UPDATE movies SET
    poster = COALESCE(?, poster),
    backdrop = COALESCE(?, backdrop),
    imdb_id = COALESCE(imdb_id, ?),
    duration = COALESCE(duration, ?),
    release_date = COALESCE(release_date, ?),
    updated_at = datetime('now')
    WHERE id = ?`).run(poster, backdrop, imdbId, duration, releaseDate, current.id);
  return true;
}

// Shared serialization so /movies/:id and /explore/movie/:source/:sourceId return the exact same
// shape (genres/cast/next-installment JSON columns decoded, no raw DB row leaking out).
export function movieRowToDetails(row) {
  return {
    movie_id: row.id,
    source: row.source,
    source_id: row.source_id,
    imdb_id: row.imdb_id,
    title: row.title,
    poster: row.poster,
    backdrop: row.backdrop,
    synopsis: row.synopsis,
    duration: row.duration,
    note: row.note,
    genres: JSON.parse(row.genres || '[]'),
    release_date: row.release_date,
    platform: row.platform,
    jw_platforms: JSON.parse(row.jw_platforms || '[]'),
    jw_score: row.jw_score,
    jw_url: row.jw_url,
    cast: JSON.parse(row.cast_json || '[]'),
    next_installment: JSON.parse(row.next_installment_json || 'null'),
  };
}
