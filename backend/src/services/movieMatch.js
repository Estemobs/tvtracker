// Pure title/year matching helpers, kept separate from catalog.js so they can be unit-tested
// without opening the SQLite database.

export function normalizeTitle(title) {
  return (title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

export function yearOf(value) {
  const match = /(\d{4})/.exec(String(value || ''));
  return match ? match[1] : null;
}

// Repairing an old row is trickier than a fresh search: its title may be French (legacy
// iTunes/Wikipedia rows) while Cinemeta only knows the English one. An exact title match is
// always safe; otherwise only accept a single result from the same year, or Cinemeta's own top
// result when its year agrees. Never guess across years — a wrong poster is worse than none.
export function pickRepairMatch(candidates, title, year) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  const target = normalizeTitle(title);
  const wantedYear = year ? String(year) : null;
  const exact = candidates.filter((candidate) => normalizeTitle(candidate.title) === target);

  if (wantedYear) {
    const exactSameYear = exact.find((candidate) => candidate.year === wantedYear);
    if (exactSameYear) return exactSameYear;
    if (exact.length === 1) return exact[0];
  } else if (exact.length === 1) {
    return exact[0];
  }

  // Ambiguous exact titles with no year confirmation: staying empty is the safe choice.
  if (exact.length || !wantedYear) return null;

  const sameYear = candidates.filter((candidate) => candidate.year === wantedYear);
  if (sameYear.length === 1) return sameYear[0];
  // A localized title rarely matches Cinemeta's English one. Search ranking is then the only
  // signal left, so trust its first result only when the year corroborates it.
  return candidates[0]?.year === wantedYear ? candidates[0] : null;
}
