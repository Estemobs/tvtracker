import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import { db } from '../db/index.js';
import * as tvmaze from './tvmaze.js';
import * as wikipedia from './wikipedia.js';
import { cacheShow, cacheMovie } from './catalog.js';

const EPISODES_FILE = 'tracking-prod-records-v2.csv';
const MOVIES_FILE = 'tracking-prod-records.csv';

// A single item failing (rate limit, network hiccup, no match) must never abort the whole
// batch — with hundreds of external lookups in one import, some failures are expected, and
// losing all prior progress over one of them would be far worse than skipping it and reporting it.
async function mapWithConcurrency(items, limit, fn, onError) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        await fn(items[i], i);
      } catch (e) {
        onError?.(items[i], e);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function toSqliteDatetime(tvTimeDate) {
  // TV Time exports "YYYY-MM-DD HH:MM:SS" already close enough to SQLite's own format.
  if (!tvTimeDate) return new Date().toISOString();
  return tvTimeDate.trim();
}

async function matchMovie(title, releaseDate) {
  const year = (releaseDate || '').slice(0, 4);
  const results = await wikipedia.searchMoviesAnyLanguage(title).catch(() => []);
  if (!results.length) return null;
  return results.find((r) => r.year === year) || results[0];
}

export async function importTvTimeArchive(buffer, userId, onProgress = () => {}) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    const err = new Error("Le fichier fourni n'est pas une archive ZIP valide.");
    err.status = 400;
    throw err;
  }

  const episodesEntry = zip.getEntry(EPISODES_FILE);
  const moviesEntry = zip.getEntry(MOVIES_FILE);
  if (!episodesEntry || !moviesEntry) {
    const err = new Error(
      `Archive TV Time invalide : ${EPISODES_FILE} et ${MOVIES_FILE} sont attendus (export RGPD depuis gdpr.tvtime.com).`
    );
    err.status = 400;
    throw err;
  }

  const episodeRows = parse(episodesEntry.getData().toString('utf8'), { columns: true, skip_empty_lines: true, relax_column_count: true });
  const movieRows = parse(moviesEntry.getData().toString('utf8'), { columns: true, skip_empty_lines: true, relax_column_count: true });

  const watchedEpisodes = episodeRows.filter((r) => r.key?.startsWith('watch-episode-') && r.series_name && r.s_id);
  const showGroups = new Map();
  for (const row of watchedEpisodes) {
    if (!showGroups.has(row.s_id)) showGroups.set(row.s_id, { name: row.series_name, episodes: [] });
    showGroups.get(row.s_id).episodes.push(row);
  }

  const summary = {
    shows_imported: 0,
    episodes_imported: 0,
    shows_not_found: [],
    movies_imported: 0,
    movies_to_watch_imported: 0,
    movies_not_found: [],
    shows_preview: [],
    movies_preview: [],
  };

  const watchedMovies = movieRows.filter((r) => r.type === 'watch' && r.entity_type === 'movie' && r.movie_name);
  const toWatchMovies = movieRows.filter((r) => r.type === 'towatch' && r.entity_type === 'movie' && r.movie_name);
  const total = showGroups.size + watchedMovies.length + toWatchMovies.length;
  let done = 0;
  const tick = (phase) => onProgress({ done: ++done, total, phase });

  await mapWithConcurrency(
    [...showGroups.entries()],
    3,
    async ([tvdbId, group]) => {
      const tvmazeId = await tvmaze.findByTvdbId(tvdbId);
      if (!tvmazeId) {
        summary.shows_not_found.push(group.name);
        tick('shows');
        return;
      }
      const show = await cacheShow(tvmazeId);
      db.prepare(`INSERT INTO user_shows (user_id, show_id) VALUES (?, ?) ON CONFLICT(user_id, show_id) DO NOTHING`)
        .run(userId, show.id);

      const upsertEpisode = db.prepare(`
        INSERT INTO user_episodes (user_id, episode_id, watched, watched_at)
        VALUES (?, ?, 1, ?)
        ON CONFLICT(user_id, episode_id) DO UPDATE SET watched = 1, watched_at = excluded.watched_at
      `);
      const findEpisode = db.prepare('SELECT id FROM episodes WHERE show_id = ? AND season = ? AND episode_number = ?');

      let matched = 0;
      for (const ep of group.episodes) {
        const row = findEpisode.get(show.id, Number(ep.season_number), Number(ep.episode_number));
        if (row) {
          upsertEpisode.run(userId, row.id, toSqliteDatetime(ep.created_at));
          matched++;
        }
      }
      summary.episodes_imported += matched;

      const total = db.prepare('SELECT COUNT(*) c FROM episodes WHERE show_id = ?').get(show.id).c;
      const watched = db.prepare(`
        SELECT COUNT(*) c FROM user_episodes ue JOIN episodes e ON e.id = ue.episode_id
        WHERE ue.user_id = ? AND e.show_id = ? AND ue.watched = 1
      `).get(userId, show.id).c;
      db.prepare(`UPDATE user_shows SET status = ? WHERE user_id = ? AND show_id = ?`)
        .run(total > 0 && watched === total ? 'completed' : 'in_progress', userId, show.id);

      summary.shows_imported++;
      summary.shows_preview.push({ title: show.title, poster: show.poster });
      tick('shows');
    },
    (group) => { summary.shows_not_found.push(group[1].name); tick('shows'); }
  );

  await mapWithConcurrency(
    watchedMovies,
    1,
    async (row) => {
      const match = await matchMovie(row.movie_name, row.release_date);
      if (!match) {
        summary.movies_not_found.push(row.movie_name);
        tick('movies');
        return;
      }
      const movie = await cacheMovie('wikipedia', match.source_id, { posterOnly: true });
      db.prepare(`
        INSERT INTO user_movies (user_id, movie_id, status, watched_at) VALUES (?, ?, 'watched', ?)
        ON CONFLICT(user_id, movie_id) DO UPDATE SET status = 'watched', watched_at = excluded.watched_at
      `).run(userId, movie.id, toSqliteDatetime(row.created_at));
      summary.movies_imported++;
      summary.movies_preview.push({ title: movie.title, poster: movie.poster });
      tick('movies');
    },
    (row) => { summary.movies_not_found.push(row.movie_name); tick('movies'); }
  );

  await mapWithConcurrency(
    toWatchMovies,
    1,
    async (row) => {
      const match = await matchMovie(row.movie_name, row.release_date);
      if (!match) {
        summary.movies_not_found.push(row.movie_name);
        tick('movies');
        return;
      }
      const movie = await cacheMovie('wikipedia', match.source_id, { posterOnly: true });
      db.prepare(`INSERT INTO user_movies (user_id, movie_id) VALUES (?, ?) ON CONFLICT(user_id, movie_id) DO NOTHING`)
        .run(userId, movie.id);
      summary.movies_to_watch_imported++;
      summary.movies_preview.push({ title: movie.title, poster: movie.poster });
      tick('movies');
    },
    (row) => { summary.movies_not_found.push(row.movie_name); tick('movies'); }
  );

  return summary;
}
