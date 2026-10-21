// One-off recovery for the migration-010 bug.
//
// Migration 010 rebuilt the `movies` table with `DROP TABLE movies`. Because
// user_movies.movie_id has ON DELETE CASCADE, SQLite deleted every row in
// user_movies at the same time. The migration is fixed for databases that have
// not reached 010 yet, but an installation that already ran the old version
// needs to recover the links from SQLite's free pages / WAL.
//
// This script:
//   1. reads tvtracker.db and tvtracker.db-wal without checkpointing them;
//   2. scans the raw bytes for deleted user_movies records;
//   3. prints what it found (dry-run by default);
//   4. with --apply, inserts the missing (user, movie) links back.
//
// Usage, inside the running app container. DO NOT stop or restart the
// container before the first dry-run: closing SQLite checkpoints the WAL and
// can erase the deleted rows we are trying to recover.
//
//   docker exec -it <container> node src/scripts/recover-user-movies.js
//   docker exec -it <container> node src/scripts/recover-user-movies.js --apply
//
// Or from backend/:
//
//   npm run recover:user-movies
//   npm run recover:user-movies -- --apply
//
// The script only inserts links that are absent; it never deletes or overwrites
// current data. If the deleted pages have already been reused, it may find
// nothing and will say so.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'tvtracker.db');
const APPLY = process.argv.includes('--apply');

const DATE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const STATUS_SERIAL = { to_watch: 0x1d, watched: 0x1b }; // text length 8 / 7
const ADDED_SERIAL = 0x33; // text length 19
const INTEGER_SIZES = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 6, 6: 8, 8: 0, 9: 0 };

function readIfExists(file) {
  try {
    return fs.readFileSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function readSignedBigEndian(buffer, offset, size) {
  let value = 0n;
  for (let i = 0; i < size; i++) value = (value << 8n) | BigInt(buffer[offset + i]);
  const bits = BigInt(size * 8);
  if (value >= (1n << (bits - 1n))) value -= 1n << bits;
  return Number(value);
}

function readFloatBigEndian(buffer, offset) {
  return buffer.readDoubleBE(offset);
}

function serialValueSize(type) {
  if (type === 0 || type === 8 || type === 9) return 0;
  if (type >= 1 && type <= 4) return type;
  if (type === 5) return 6;
  if (type === 6 || type === 7) return 8;
  if (type >= 12) return Math.floor((type - 12) / 2);
  return null;
}

function readIntValue(buffer, offset, type) {
  if (type === 8) return 0;
  if (type === 9) return 1;
  const size = INTEGER_SIZES[type];
  if (!size) return null;
  return readSignedBigEndian(buffer, offset, size);
}

function readRating(buffer, offset, type) {
  if (type === 0) return null;
  if (type === 7) return readFloatBigEndian(buffer, offset);
  return readIntValue(buffer, offset, type);
}

function readText(buffer, offset, type) {
  const size = serialValueSize(type);
  if (!size) return null;
  return buffer.subarray(offset, offset + size).toString('utf8');
}

function parseRecordAt(buffer, statusPos, statusText) {
  const statusSerial = STATUS_SERIAL[statusText];

  // A user_movies record has six columns, all serial types fit on one byte, so
  // the header length is always 7. The first two columns are integers; try
  // every possible integer width to locate the start of the record.
  for (const [userIdType, userIdSize] of Object.entries(INTEGER_SIZES)) {
    for (const [movieIdType, movieIdSize] of Object.entries(INTEGER_SIZES)) {
      const recordStart = statusPos - 7 - userIdSize - movieIdSize;
      if (recordStart < 0) continue;
      if (buffer[recordStart] !== 7) continue;
      if (buffer[recordStart + 1] !== Number(userIdType)) continue;
      if (buffer[recordStart + 2] !== Number(movieIdType)) continue;
      if (buffer[recordStart + 3] !== statusSerial) continue;
      if (buffer[recordStart + 5] !== ADDED_SERIAL) continue;

      const ratingType = buffer[recordStart + 4];
      const watchedType = buffer[recordStart + 6];
      if (ratingType !== 0 && ratingType !== 7 && !INTEGER_SIZES[ratingType]) continue;
      if (watchedType !== 0 && watchedType !== ADDED_SERIAL) continue;

      const payloadStart = recordStart + 7;
      const userId = readIntValue(buffer, payloadStart, Number(userIdType));
      const movieId = readIntValue(buffer, payloadStart + userIdSize, Number(movieIdType));
      if (!Number.isInteger(userId) || userId <= 0) continue;
      if (!Number.isInteger(movieId) || movieId <= 0) continue;

      const ratingSize = serialValueSize(ratingType);
      const ratingOffset = statusPos + statusText.length;
      const addedOffset = ratingOffset + ratingSize;
      const watchedOffset = addedOffset + 19;
      const watchedSize = watchedType === ADDED_SERIAL ? 19 : 0;
      if (watchedOffset + watchedSize > buffer.length) continue;

      const personalRating = readRating(buffer, ratingOffset, ratingType);
      if (personalRating !== null && (personalRating < 0 || personalRating > 10)) continue;

      const addedAt = readText(buffer, addedOffset, ADDED_SERIAL);
      if (!addedAt || !DATE_RE.test(addedAt)) continue;

      const watchedAt = watchedSize ? readText(buffer, watchedOffset, watchedType) : null;
      if (watchedAt !== null && !DATE_RE.test(watchedAt)) continue;

      return {
        user_id: userId,
        movie_id: movieId,
        status: statusText,
        personal_rating: personalRating,
        added_at: addedAt,
        watched_at: watchedAt,
      };
    }
  }

  return null;
}

function scanBuffer(buffer, source, found) {
  for (const statusText of Object.keys(STATUS_SERIAL)) {
    let pos = 0;
    while ((pos = buffer.indexOf(statusText, pos)) !== -1) {
      const record = parseRecordAt(buffer, pos, statusText);
      if (record) found.push({ ...record, source });
      pos += 1;
    }
  }
}

function chooseBest(records) {
  return [...records].sort((a, b) => {
    // Prefer a complete watched row, then a rated row; otherwise keep the
    // first occurrence. This only decides between duplicate copies of the
    // same (user, movie) link, not which links to restore.
    const score = (row) => (row.watched_at ? 4 : 0) + (row.status === 'watched' ? 2 : 0)
      + (row.personal_rating !== null ? 1 : 0);
    return score(b) - score(a);
  })[0];
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[recover] base introuvable : ${DB_PATH}`);
    console.error('[recover] définissez DATA_DIR (ex. /data) ou DB_PATH.');
    process.exitCode = 1;
    return;
  }

  const buffers = [];
  const dbBuffer = readIfExists(DB_PATH);
  if (dbBuffer) buffers.push({ source: path.basename(DB_PATH), buffer: dbBuffer });
  const walBuffer = readIfExists(`${DB_PATH}-wal`);
  if (walBuffer) buffers.push({ source: `${path.basename(DB_PATH)}-wal`, buffer: walBuffer });

  console.log(`[recover] base : ${DB_PATH}`);
  console.log(`[recover] fichiers lus : ${buffers.map((item) => `${item.source} (${item.buffer.length} octets)`).join(', ')}`);

  const raw = [];
  for (const { source, buffer } of buffers) scanBuffer(buffer, source, raw);

  if (!raw.length) {
    console.log('\n[recover] Aucun enregistrement user_movies supprimé trouvé.');
    console.log('[recover] Les pages libérées ont probablement été réutilisées. Une sauvegarde');
    console.log('[recover] de la base ou un export TV Time est alors la seule solution.');
    return;
  }

  const byKey = new Map();
  for (const record of raw) {
    const key = `${record.user_id}:${record.movie_id}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(record);
  }

  // Never open the real database in dry-run mode: opening a WAL database can
  // checkpoint (and truncate) the very WAL we just scanned. Validate against a
  // temporary copy instead.
  let db;
  let cleanup = () => {};
  if (APPLY) {
    db = new Database(DB_PATH);
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
  } else {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvtracker-recover-'));
    const tempDbPath = path.join(tempDir, 'tvtracker.db');
    fs.copyFileSync(DB_PATH, tempDbPath);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(`${DB_PATH}${suffix}`)) {
        fs.copyFileSync(`${DB_PATH}${suffix}`, `${tempDbPath}${suffix}`);
      }
    }
    db = new Database(tempDbPath);
    db.pragma('busy_timeout = 5000');
    cleanup = () => {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    };
  }

  const users = new Set(db.prepare('SELECT id FROM users').all().map((row) => row.id));
  const movies = new Set(db.prepare('SELECT id FROM movies').all().map((row) => row.id));
  const current = new Map(
    db.prepare('SELECT user_id, movie_id FROM user_movies').all()
      .map((row) => [`${row.user_id}:${row.movie_id}`, row]),
  );

  const recovered = [];
  const alreadyPresent = [];
  const unknown = [];
  for (const [key, records] of byKey) {
    const row = chooseBest(records);
    if (current.has(key)) {
      alreadyPresent.push(row);
    } else if (!users.has(row.user_id) || !movies.has(row.movie_id)) {
      unknown.push(row);
    } else {
      recovered.push(row);
    }
  }

  console.log(`\n[recover] ${raw.length} copie(s) brute(s), ${byKey.size} lien(s) distinct(s).`);
  console.log(`[recover] ${recovered.length} lien(s) récupérable(s), ${alreadyPresent.length} déjà présent(s), ${unknown.length} ignoré(s) (utilisateur/film inconnu).`);

  if (recovered.length) {
    const preview = recovered.slice(0, 50);
    for (const row of preview) {
      console.log(`  user ${row.user_id} -> film ${row.movie_id} : ${row.status}`
        + `${row.personal_rating !== null ? `, note ${row.personal_rating}` : ''}`
        + ` (ajouté ${row.added_at}${row.watched_at ? `, vu ${row.watched_at}` : ''})`);
    }
    if (recovered.length > preview.length) {
      console.log(`  ... et ${recovered.length - preview.length} autre(s).`);
    }

    if (!APPLY) {
      console.log('\n[recover] Mode lecture seule. Relancez avec --apply pour restaurer ces liens.');
    } else {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO user_movies
          (user_id, movie_id, status, personal_rating, added_at, watched_at)
        VALUES
          (@user_id, @movie_id, @status, @personal_rating, @added_at, @watched_at)
      `);
      const apply = db.transaction((rows) => {
        for (const row of rows) insert.run(row);
      });
      apply(recovered);
      console.log(`\n[recover] ${recovered.length} lien(s) restauré(s).`);
    }
  }

  cleanup();
  if (APPLY) db.close();
}

main();
