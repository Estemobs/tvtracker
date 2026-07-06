const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

// Wikipedia/Wikidata/TVmaze occasionally return a transient 429/5xx under load. Without a
// retry, that single hiccup gets treated as "this show/movie genuinely has no cast/poster"
// and cached as such for a full day (see STALE_MS) — a couple of short retries turns a
// rare transient failure into a non-issue instead of visibly degraded content.
export async function fetchWithRetry(url, options = {}, retries = 2) {
  let lastResp;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const resp = await fetch(url, options);
    if (resp.ok || !RETRYABLE_STATUSES.has(resp.status)) return resp;
    lastResp = resp;
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  return lastResp;
}
