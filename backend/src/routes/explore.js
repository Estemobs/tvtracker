import { Router } from 'express';
import { db } from '../db/index.js';
import * as tvmaze from '../services/tvmaze.js';
import * as itunes from '../services/itunes.js';
import * as wikipedia from '../services/wikipedia.js';
import * as wikidata from '../services/wikidata.js';
import * as justwatch from '../services/justwatch.js';
import { enrichMovieWithWikidata } from '../services/catalog.js';
import { requireAuth } from '../middleware/auth.js';
import { bulkImportContext, mapWithLimit } from '../services/httpRetry.js';
import { log as debugLog } from '../services/debugLog.js';

const router = Router();
router.use(requireAuth);

// Shows and movies come from independent sources/queries that can each legitimately return the
// same source+source_id more than once (e.g. a French-search hit and its English-fallback
// resolution landing on the same Wikipedia article) — collapse those before they reach the UI.
function dedupe(results) {
  const seen = new Set();
  return results.filter((r) => {
    const key = `${r.source}:${r.source_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function annotateAdded(req, results) {
  const showKeys = new Set(
    db.prepare(`SELECT source, source_id FROM shows s JOIN user_shows us ON us.show_id = s.id WHERE us.user_id = ?`)
      .all(req.user.id).map((r) => `${r.source}:${r.source_id}`)
  );
  const movieKeys = new Set(
    db.prepare(`SELECT source, source_id FROM movies m JOIN user_movies um ON um.movie_id = m.id WHERE um.user_id = ?`)
      .all(req.user.id).map((r) => `${r.source}:${r.source_id}`)
  );
  return results.map((r) => ({
    ...r,
    already_added: (r.media_type === 'movie' ? movieKeys : showKeys).has(`${r.source}:${r.source_id}`),
  }));
}

router.get('/search', async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q) return res.json({ results: [] });
    const [shows, movies] = await Promise.all([
      tvmaze.searchShows(q).catch(() => []),
      wikipedia.searchMoviesAnyLanguage(q).catch(() => []),
    ]);

    res.json({ results: annotateAdded(req, dedupe([...shows, ...movies])) });
  } catch (e) { next(e); }
});

// JustWatch only knows titles, not this app's TVmaze/Wikipedia ids — a JustWatch ranking is
// resolved back into our own catalog via the same title search already used by /search, so the
// result links, posters and "already_added" flag all behave exactly like everywhere else in the
// app. `forceType`, when given, stamps the result with that type rather than trusting TVmaze's own
// genre tag: TVmaze's "Anime" genre is inconsistently applied (e.g. it's missing on One Piece
// itself), so for the anime category the classification already done upstream — JustWatch's
// "Animation" genre restricted to Japanese productions — is the more reliable signal.
//
// `concurrency` defaults low: a single movie title search can itself fan out to several Wikidata
// calls (missing-poster fallback, see wikipedia.js), so resolving titles here at any real
// concurrency multiplies into a burst big enough to trip Wikidata's rate limiter — which then
// stalls *unrelated* Wikipedia-backed features (e.g. someone else's Explorer search) for the
// duration of the cooldown. Shows don't have that fan-out (TVmaze is a single call per title).
async function resolveJustWatchItems(jwItems, resolver, { forceType, limit = 10, concurrency = 2 } = {}) {
  const resolved = await mapWithLimit(jwItems, concurrency, async (jw) => {
    try {
      const matches = await resolver(jw.title);
      const match = matches[0];
      if (!match) return null;
      return { ...match, type: forceType || match.type, jw_rank: jw.rank, platforms: jw.platforms };
    } catch {
      return null;
    }
  });
  return dedupe(resolved.filter(Boolean)).slice(0, limit);
}

const resolveShow = (title) => tvmaze.searchShows(title);
const resolveMovie = (title) => wikipedia.searchMoviesAnyLanguage(title);

// A full trending refresh fans out to JustWatch plus ~5 title searches per category against
// TVmaze/Wikipedia — too slow and too heavy on those hosts to redo on every Explorer page view,
// and the ranking itself doesn't meaningfully change minute to minute. Cached process-wide (not
// per-user: annotateAdded, the only per-user part, is applied fresh on every request below).
let trendingCache = { data: null, expiresAt: 0 };
const TRENDING_CACHE_MS = 60 * 60 * 1000;
// A page load must never wait on the full refresh: on a slow/rate-limited day it can legitimately
// take minutes (each of the ~180 title-search calls can retry with growing backoff — see
// httpRetry.js), which is exactly what made the Explorer page look permanently stuck loading with
// nothing on screen. A true cold start (nothing cached yet) waits at most this long before falling
// back to an empty result; once *anything* is cached, a request never waits on a refresh at all —
// see the stale-while-revalidate branch below.
const TRENDING_COLD_START_TIMEOUT_MS = 8000;
// Several requests can land while the cache is cold (e.g. two users opening Explorer around the
// same time right after a restart) — without this, each would kick off its own full JustWatch +
// title-search refresh in parallel, multiplying the exact rate-limit pressure the concurrency cap
// above is trying to avoid. Sharing the in-flight promise means only the first request pays for it.
let trendingRefresh = null;

function emptyTrendingCategories() {
  return { top10Series: [], top10Animes: [], top10Movies: [], newSeries: [], newAnimes: [], newMovies: [] };
}

async function buildTrendingCategories() {
  const [jwSeries, jwAnimes, jwMovies, jwNewSeries, jwNewAnimes, jwNewMovies] = await Promise.all([
    justwatch.getPopular('SHOW', { excludeGenres: ['ani'] }),
    justwatch.getPopular('SHOW', { genres: ['ani'], productionCountries: ['JP'] }),
    justwatch.getPopular('MOVIE'),
    justwatch.getNew('SHOW', { excludeGenres: ['ani'] }),
    justwatch.getNew('SHOW', { genres: ['ani'], productionCountries: ['JP'] }),
    justwatch.getNew('MOVIE'),
  ]);

  const [top10Series, top10Animes, top10Movies, newSeries, newAnimes, newMovies] = await Promise.all([
    resolveJustWatchItems(jwSeries, resolveShow, { forceType: 'serie', concurrency: 4 }),
    resolveJustWatchItems(jwAnimes, resolveShow, { forceType: 'anime', concurrency: 4 }),
    resolveJustWatchItems(jwMovies, resolveMovie),
    resolveJustWatchItems(jwNewSeries, resolveShow, { forceType: 'serie', concurrency: 4 }),
    resolveJustWatchItems(jwNewAnimes, resolveShow, { forceType: 'anime', concurrency: 4 }),
    resolveJustWatchItems(jwNewMovies, resolveMovie),
  ]);

  return { top10Series, top10Animes, top10Movies, newSeries, newAnimes, newMovies };
}

async function refreshTrendingCache() {
  const startedAt = Date.now();
  debugLog('trending', 'Rafraîchissement démarré.');
  try {
    // Full rate-limit backoff, not the short interactive cap: this always runs detached from any
    // request (background warm-up, or fire-and-forget below) — nobody's waiting on it directly.
    const data = await bulkImportContext.run(true, buildTrendingCategories);
    trendingCache = { data, expiresAt: Date.now() + TRENDING_CACHE_MS };
    debugLog('trending', `Rafraîchissement terminé en ${Date.now() - startedAt}ms — `
      + `séries ${data.top10Series.length}/10, animes ${data.top10Animes.length}/10, films ${data.top10Movies.length}/10, `
      + `nouveautés séries/animes/films ${data.newSeries.length}/${data.newAnimes.length}/${data.newMovies.length}.`);
  } catch (error) {
    console.error('[trending] refresh failed:', error);
    debugLog('trending', `Échec du rafraîchissement après ${Date.now() - startedAt}ms : ${error.message}`);
    // JustWatch is an unofficial, undocumented API — if it's down or its schema shifted, keep
    // serving the last good ranking (if any) rather than a broken Explorer page. If there's never
    // been a good ranking yet, cache an empty one anyway so a broken upstream doesn't force every
    // single request to retry the same slow failure — just retry sooner than a full hour.
    if (!trendingCache.data) trendingCache = { data: emptyTrendingCategories(), expiresAt: Date.now() + 5 * 60 * 1000 };
  }
}

function triggerTrendingRefresh() {
  if (!trendingRefresh) {
    trendingRefresh = refreshTrendingCache().finally(() => { trendingRefresh = null; });
  }
  return trendingRefresh;
}

// Runs once at server startup (see index.js) so the cache is normally already warm by the time
// anyone opens Explorer, and again every TRENDING_CACHE_MS to keep it that way.
export function startTrendingWarmup() {
  void triggerTrendingRefresh();
  setInterval(() => void triggerTrendingRefresh(), TRENDING_CACHE_MS);
}

router.get('/trending', async (req, res, next) => {
  try {
    if (!trendingCache.data) {
      // True cold start — bound the wait, never hang the page on it.
      await Promise.race([triggerTrendingRefresh(), new Promise((r) => setTimeout(r, TRENDING_COLD_START_TIMEOUT_MS))]);
    } else if (Date.now() > trendingCache.expiresAt) {
      // Stale-while-revalidate: serve what we have immediately, refresh happens in the background.
      void triggerTrendingRefresh();
    }
    const c = trendingCache.data || emptyTrendingCategories();
    res.json({
      top10_series: annotateAdded(req, c.top10Series),
      top10_animes: annotateAdded(req, c.top10Animes),
      top10_movies: annotateAdded(req, c.top10Movies),
      new_series: annotateAdded(req, c.newSeries),
      new_animes: annotateAdded(req, c.newAnimes),
      new_movies: annotateAdded(req, c.newMovies),
    });
  } catch (e) { next(e); }
});

router.get('/discover/:mediaType', async (req, res, next) => {
  try {
    const { mediaType } = req.params;
    if (!['tv', 'movie'].includes(mediaType)) return res.status(400).json({ error: 'Type invalide.' });
    const { genre } = req.query;
    if (mediaType === 'tv') {
      const results = await tvmaze.discoverByGenre(genre);
      return res.json({ results: annotateAdded(req, results) });
    }
    const movies = await itunes.topMovies();
    const filtered = genre ? movies.filter((m) => m.genre === genre) : movies;
    res.json({ results: annotateAdded(req, filtered) });
  } catch (e) { next(e); }
});

router.get('/genres/:mediaType', (req, res) => {
  if (req.params.mediaType === 'tv') return res.json(tvmaze.GENRES);
  res.json(['Action & Adventure', 'Comedy', 'Drama', 'Horror', 'Romance', 'Science-Fiction', 'Thriller', 'Animation']);
});

router.get('/tv/:sourceId', async (req, res, next) => {
  try {
    const [details, cast] = await Promise.all([
      tvmaze.getShowDetails(req.params.sourceId),
      tvmaze.getCast(req.params.sourceId).catch(() => []),
    ]);
    const cachedShow = db.prepare(`SELECT id FROM shows WHERE source = 'tvmaze' AND source_id = ?`).get(req.params.sourceId);
    const addedByCount = cachedShow
      ? db.prepare('SELECT COUNT(*) c FROM user_shows WHERE show_id = ?').get(cachedShow.id).c
      : 0;
    const already = cachedShow
      ? db.prepare(`SELECT 1 FROM user_shows WHERE user_id = ? AND show_id = ?`).get(req.user.id, cachedShow.id)
      : null;
    res.json({ ...details, cast, added_by_count: addedByCount, already_added: !!already, show_id: already ? cachedShow.id : null });
  } catch (e) { next(e); }
});

router.get('/movie/:source/:sourceId', async (req, res, next) => {
  try {
    const { source, sourceId } = req.params;
    if (!['itunes', 'wikipedia'].includes(source)) return res.status(400).json({ error: 'Source invalide.' });
    const baseDetails = source === 'itunes'
      ? await itunes.getMovieDetails(sourceId)
      : await wikipedia.getMovieSummary(sourceId);
    const details = await enrichMovieWithWikidata(baseDetails);

    const cachedMovie = db.prepare('SELECT id FROM movies WHERE source = ? AND source_id = ?').get(source, sourceId);
    const addedByCount = cachedMovie
      ? db.prepare('SELECT COUNT(*) c FROM user_movies WHERE movie_id = ?').get(cachedMovie.id).c
      : 0;
    const already = cachedMovie
      ? db.prepare(`SELECT 1 FROM user_movies WHERE user_id = ? AND movie_id = ?`).get(req.user.id, cachedMovie.id)
      : null;

    res.json({ ...details, added_by_count: addedByCount, already_added: !!already, movie_id: already ? cachedMovie.id : null });
  } catch (e) { next(e); }
});

router.get('/actor/:personId', async (req, res, next) => {
  try {
    const { personId } = req.params;
    const isWikidataId = /^Q\d+$/.test(personId);

    const [person, filmography] = isWikidataId
      ? await Promise.all([wikidata.getPerson(personId), wikidata.getPersonFilmography(personId)])
      : await Promise.all([tvmaze.getPerson(personId), tvmaze.getPersonFilmography(personId)]);

    if (!person) return res.status(404).json({ error: 'Acteur introuvable.' });
    const bio = await wikipedia.getPersonBio(person.name).catch(() => null);
    res.json({ ...person, bio, filmography });
  } catch (e) { next(e); }
});

export default router;
