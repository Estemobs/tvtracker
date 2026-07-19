import { Router } from 'express';
import { db } from '../db/index.js';
import * as tvmaze from '../services/tvmaze.js';
import * as itunes from '../services/itunes.js';
import * as wikipedia from '../services/wikipedia.js';
import * as wikidata from '../services/wikidata.js';
import * as justwatch from '../services/justwatch.js';
import { enrichMovieWithWikidata } from '../services/catalog.js';
import { requireAuth } from '../middleware/auth.js';
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

// Earlier version of this resolved every JustWatch title against TVmaze/Wikipedia *up front*, at
// cache-build time, to get this app's own catalog id/poster/link for all ~180 titles across the
// 6 categories. That made the whole page depend on ~180 external title searches succeeding —
// exactly the burst that kept tripping Wikidata/Wikipedia's rate limiter and left Explorer showing
// nothing for minutes at a time. JustWatch already gives us a title, a poster (its own CDN, see
// posterUrl in justwatch.js) and platforms — enough to render the page with zero TVmaze/Wikipedia
// calls. Resolving a title to this app's catalog now only happens for the *one* title someone
// actually clicks, via GET /explore/resolve below.
function formatJustWatchItems(jwItems, { mediaType, type, limit = 10 }) {
  return jwItems.slice(0, limit).map((jw) => ({
    media_type: mediaType,
    type,
    title: jw.title,
    poster: jw.poster,
    year: jw.year,
    jw_rank: jw.rank,
    platforms: jw.platforms,
  }));
}

const resolveShow = (title) => tvmaze.searchShows(title);

// Resolves a single title someone clicked on in a Top10/Nouveautés row into this app's own
// catalog entry (source/source_id/poster/...), the same way /search already does — just for one
// item at a time, at the pace of actual clicks, instead of a whole category at once.
//
// Movies use findMovieBestMatch, not resolveMovie/searchMoviesAnyLanguage: that function resolves
// a poster for every candidate in the results list (right for the /search grid), but here only
// the first match is ever shown — resolving the rest was pure wasted latency (and Wikidata load)
// on every single click, which is what made opening a movie feel slow next to a show/anime (TVmaze
// resolves a show in one call; the old movie path could easily be five times that).
router.get('/resolve', async (req, res, next) => {
  try {
    const { title, media_type: mediaType } = req.query;
    if (!title || !['tv', 'movie'].includes(mediaType)) return res.status(400).json({ error: 'Paramètres invalides.' });
    const match = mediaType === 'tv' ? (await resolveShow(title))[0] : await wikipedia.findMovieBestMatch(title);
    if (!match) return res.status(404).json({ error: 'Introuvable dans le catalogue.' });
    res.json(annotateAdded(req, [match])[0]);
  } catch (e) { next(e); }
});

// A full trending refresh fans out to 6 JustWatch queries — fast and not dependent on
// TVmaze/Wikipedia at all (see formatJustWatchItems above) — but the ranking itself doesn't
// meaningfully change minute to minute either way, so it's still cached process-wide (not
// per-user: annotateAdded, the only per-user part, is applied fresh on every request below).
let trendingCache = { data: null, expiresAt: 0 };
const TRENDING_CACHE_MS = 60 * 60 * 1000;
// A page load must never wait on the full refresh — JustWatch is an unofficial API and can be
// slow or briefly unreachable. A true cold start (nothing cached yet) waits at most this long
// before falling back to an empty result; once *anything* is cached, a request never waits on a
// refresh at all — see the stale-while-revalidate branch below.
const TRENDING_COLD_START_TIMEOUT_MS = 8000;
// Several requests can land while the cache is cold (e.g. two users opening Explorer around the
// same time right after a restart) — without this, each would kick off its own JustWatch refresh
// in parallel. Sharing the in-flight promise means only the first request pays for it.
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

  return {
    top10Series: formatJustWatchItems(jwSeries, { mediaType: 'tv', type: 'serie' }),
    top10Animes: formatJustWatchItems(jwAnimes, { mediaType: 'tv', type: 'anime' }),
    top10Movies: formatJustWatchItems(jwMovies, { mediaType: 'movie', type: 'movie' }),
    newSeries: formatJustWatchItems(jwNewSeries, { mediaType: 'tv', type: 'serie' }),
    newAnimes: formatJustWatchItems(jwNewAnimes, { mediaType: 'tv', type: 'anime' }),
    newMovies: formatJustWatchItems(jwNewMovies, { mediaType: 'movie', type: 'movie' }),
  };
}

async function refreshTrendingCache() {
  const startedAt = Date.now();
  debugLog('trending', 'Rafraîchissement démarré.');
  try {
    const data = await buildTrendingCategories();
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
    // Unlike /search or /resolve, these items aren't tied to this app's catalog yet (see
    // formatJustWatchItems above) — there's no source/source_id to check "already_added" against
    // until the title is actually resolved, which only happens when someone clicks it.
    res.json({
      top10_series: c.top10Series,
      top10_animes: c.top10Animes,
      top10_movies: c.top10Movies,
      new_series: c.newSeries,
      new_animes: c.newAnimes,
      new_movies: c.newMovies,
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
    // Movies used to filter iTunes's ~40-title top chart by genre — a pool that small rarely had
    // more than a couple of matches for any given genre. JustWatch's own genre filter (already
    // used for the Top10/Nouveautés movie rows) draws from its whole catalog instead, so browsing
    // a genre actually returns a genre's worth of results. Same deal as Top10: shown as-is from
    // JustWatch, resolved into this app's catalog only when a title is actually clicked.
    const jwMovies = await justwatch.getPopular('MOVIE', { first: 24, ...(genre ? { genres: [genre] } : {}) });
    res.json({ results: formatJustWatchItems(jwMovies, { mediaType: 'movie', type: 'movie', limit: 24 }) });
  } catch (e) { next(e); }
});

router.get('/genres/:mediaType', (req, res) => {
  if (req.params.mediaType === 'tv') return res.json(tvmaze.GENRES.map((g) => ({ value: g, label: g })));
  res.json(justwatch.MOVIE_GENRES);
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
