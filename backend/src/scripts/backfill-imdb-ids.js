// One-off migration: give every already-stored movie its IMDb id and re-key it to Cinemeta.
//
//   cd backend && npm run backfill:imdb
//
// Safe matches (exact normalized title + matching year when a year is known) are applied
// automatically. Anything else is printed for manual review instead of guessing — attaching the
// wrong IMDb id to someone's watched film is much worse than leaving it for a human.
//
// Add --dry-run to see what would happen without writing anything.
import { db } from '../db/index.js';
import * as cinemeta from '../services/cinemeta.js';

const DRY_RUN = process.argv.includes('--dry-run');
const REQUEST_GAP_MS = 300;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeTitle(title) {
  return (title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function yearOf(movie) {
  return (movie.release_date || '').slice(0, 4);
}

function pickSafeMatch(movie, candidates) {
  const target = normalizeTitle(movie.title);
  const year = yearOf(movie);
  const exact = candidates.filter((candidate) => normalizeTitle(candidate.title) === target);

  if (!exact.length) {
    return { match: null, reason: 'aucun titre exact', candidates };
  }
  if (year) {
    const sameYear = exact.filter((candidate) => candidate.year === year);
    if (sameYear.length === 1) return { match: sameYear[0] };
    return {
      match: null,
      reason: sameYear.length ? 'plusieurs films correspondent titre + année' : 'année différente',
      candidates: exact,
    };
  }
  if (exact.length === 1) return { match: exact[0] };
  return { match: null, reason: 'plusieurs films portent ce titre', candidates: exact };
}

function mergeIntoExistingMovie(oldMovieId, imdbId) {
  const existing = db.prepare(`SELECT id FROM movies WHERE source = 'cinemeta' AND source_id = ? AND id != ?`)
    .get(imdbId, oldMovieId);
  if (!existing) return null;

  const userRows = db.prepare('SELECT * FROM user_movies WHERE movie_id = ?').all(oldMovieId);
  const upsert = db.prepare(`
    INSERT INTO user_movies (user_id, movie_id, status, personal_rating, added_at, watched_at)
    VALUES (@user_id, @movie_id, @status, @personal_rating, @added_at, @watched_at)
    ON CONFLICT(user_id, movie_id) DO UPDATE SET
      status = CASE
        WHEN user_movies.status = 'watched' OR excluded.status = 'watched' THEN 'watched'
        ELSE 'to_watch'
      END,
      personal_rating = COALESCE(user_movies.personal_rating, excluded.personal_rating),
      watched_at = COALESCE(user_movies.watched_at, excluded.watched_at)
  `);
  for (const row of userRows) {
    upsert.run({ ...row, movie_id: existing.id });
  }
  db.prepare('DELETE FROM user_movies WHERE movie_id = ?').run(oldMovieId);
  db.prepare('DELETE FROM movies WHERE id = ?').run(oldMovieId);
  return existing.id;
}

function applyImdbId(movie, imdbId) {
  if (DRY_RUN) return { action: 'would-update' };
  return db.transaction(() => {
    const mergedInto = mergeIntoExistingMovie(movie.id, imdbId);
    if (mergedInto) return { action: 'merged', targetId: mergedInto };
    // Force the next cacheMovie() read to refresh from Cinemeta instead of keeping the old
    // provider's sheet for up to a week just because it happened to be recently updated.
    db.prepare(`UPDATE movies SET imdb_id = ?, source = 'cinemeta', source_id = ?,
      updated_at = datetime('now', '-8 days') WHERE id = ?`)
      .run(imdbId, imdbId, movie.id);
    return { action: 'updated' };
  })();
}

async function main() {
  const movies = db.prepare(`
    SELECT id, source, source_id, imdb_id, title, release_date
    FROM movies
    WHERE imdb_id IS NULL OR source != 'cinemeta'
    ORDER BY id
  `).all();

  console.log(`[backfill] ${movies.length} film(s) à examiner.${DRY_RUN ? ' (dry-run)' : ''}`);

  let updated = 0;
  const ambiguous = [];

  for (const movie of movies) {
    // Already re-keyed but just missing the indexed column: no external request needed.
    if (movie.source === 'cinemeta' && /^tt\d+$/.test(movie.source_id)) {
      if (!DRY_RUN) db.prepare('UPDATE movies SET imdb_id = ? WHERE id = ?').run(movie.source_id, movie.id);
      updated++;
      continue;
    }

    if (movie.imdb_id) {
      const result = applyImdbId(movie, movie.imdb_id);
      console.log(`[backfill] #${movie.id} « ${movie.title} » -> ${movie.imdb_id} (${result.action})`);
      updated++;
      continue;
    }

    await sleep(REQUEST_GAP_MS);
    let candidates = [];
    try {
      candidates = await cinemeta.searchMovies(movie.title);
    } catch (error) {
      ambiguous.push({ movie, reason: `recherche Cinemeta impossible : ${error.message}`, candidates: [] });
      continue;
    }

    const { match, reason, candidates: possible } = pickSafeMatch(movie, candidates);
    if (!match) {
      ambiguous.push({ movie, reason, candidates: possible });
      continue;
    }

    const result = applyImdbId(movie, match.source_id);
    console.log(`[backfill] #${movie.id} « ${movie.title} » (${yearOf(movie) || '?'}) -> ${match.source_id} « ${match.title} » (${result.action})`);
    updated++;
  }

  console.log(`\n[backfill] ${updated} film(s) ${DRY_RUN ? 'seraient mis à jour' : 'mis à jour'}.`);

  if (ambiguous.length) {
    console.log(`\n[backfill] ${ambiguous.length} cas ambigu(s) à traiter à la main :`);
    for (const { movie, reason, candidates } of ambiguous) {
      console.log(`- #${movie.id} « ${movie.title} » (${yearOf(movie) || 'année inconnue'}) `
        + `[${movie.source}:${movie.source_id}] — ${reason}`);
      for (const candidate of candidates.slice(0, 5)) {
        console.log(`    • ${candidate.source_id} — « ${candidate.title} » (${candidate.year || '?'})`);
      }
    }
    console.log('\nCorrigez manuellement avec :');
    console.log("  UPDATE movies SET imdb_id = 'tt...', source = 'cinemeta', source_id = 'tt...' WHERE id = <id>;");
  }
}

main().catch((error) => {
  console.error('[backfill] échec :', error);
  process.exitCode = 1;
});
