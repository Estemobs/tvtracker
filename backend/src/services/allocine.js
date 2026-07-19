import { fetchWithRetry } from './httpRetry.js';

// AlloCiné has no public API, so this parses their server-rendered filmography page directly —
// it's the "take another source" fix for actor filmographies: Wikidata's P161 reverse lookup
// (the previous movie-credit source) is crowd-sourced and structurally incomplete next to a
// dedicated film database's own cast records. AlloCiné's actor page mirrors that same
// completeness (it's effectively the French IMDb). Being an unofficial scrape of normal page
// markup (not a documented API), it can break if they redesign the page — every call here is
// wrapped in try/catch by its one caller (routes/explore.js) so that just means falling back to
// the Wikidata list, not a broken page.
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' };

const ROW_RE = /filmography-year">\s*(\d{4})\s*<[\s\S]*?data-src="([^"]+)"[\s\S]*?fichefilm_gen_cfilm=(\d+)\.html" class="filmography-text-item filmography-entity-title" title="([^"]*)"/g;

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è');
}

function upscalePoster(url) {
  return url.replace(/\/c_\d+_\d+\//, '/c_300_400/');
}

// Only the "as actor" section (AlloCiné also separately lists directing/writing/producing
// credits on the same page, under different section ids) — mixing those in would misrepresent a
// director cameo as a starring role.
export async function getActorFilmography(allocineId) {
  const resp = await fetchWithRetry(`https://www.allocine.fr/personne/fichepersonne-${allocineId}/filmographie/`, { headers: HEADERS });
  if (!resp.ok) return [];
  const html = await resp.text();

  const sectionStart = html.indexOf('<section class="section" id="actor">');
  if (sectionStart === -1) return [];
  const rest = html.slice(sectionStart);
  const nextSection = rest.indexOf('<section class="section" id="', 10);
  const section = nextSection === -1 ? rest : rest.slice(0, nextSection);

  const films = [];
  const seen = new Set();
  let match;
  while ((match = ROW_RE.exec(section))) {
    const [, year, poster, filmId, rawTitle] = match;
    if (seen.has(filmId)) continue;
    seen.add(filmId);
    films.push({
      title: decodeEntities(rawTitle),
      year,
      poster: poster.startsWith('data:') ? null : upscalePoster(poster),
      media_type: 'movie',
    });
  }
  return films;
}
