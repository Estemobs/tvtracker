import { AsyncLocalStorage } from 'node:async_hooks';
import { log as debugLog } from './debugLog.js';

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRY_DELAY_MS = 3000;
const REQUEST_TIMEOUT_MS = 12000;

// Per-request retries alone weren't enough during a large TV Time import: once Wikipedia starts
// rate-limiting one request, every *other* in-flight or upcoming request to the same host keeps
// hammering it too (each with its own retries), which just prolongs the throttling window instead
// of backing off from it. This is a small shared circuit breaker per hostname — a 429 anywhere
// pauses *all* subsequent calls to that host for a bit, growing on repeated hits and resetting
// once things are healthy again, instead of every caller independently retrying into the same wall.
const BASE_COOLDOWN_MS = 2000;
const MAX_COOLDOWN_MS = 20000;
const hostState = new Map(); // hostname -> { until, backoff }

// A cooldown that's appropriate for a bulk import (fine to sit and wait up to MAX_COOLDOWN_MS,
// nobody's watching a spinner) is exactly what makes live, interactive requests — someone typing
// in the Explorer search box — feel frozen for many seconds if a background import happens to be
// tripping the same host's circuit breaker at the same time. Bulk jobs opt into the full wait via
// this context; everything else caps it short and would rather return quickly with a retry or a
// gap than block the UI.
export const bulkImportContext = new AsyncLocalStorage();
const INTERACTIVE_MAX_WAIT_MS = 1200;

function hostnameOf(url) {
  try { return new URL(url).hostname; } catch { return 'unknown'; }
}

// A plain Promise.all(items.map(fn)) fires every call at once — fine for a handful of requests,
// but for anything that can fan out to a couple dozen (e.g. resolving a poster for every search
// result missing one) that's enough of a burst to trip a host's own rate limiter outright, which
// then — via the circuit breaker above — stalls every *other* unrelated request to that host too.
// Capping how many run at a time keeps a single caller from ever generating that burst.
export async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function waitForCooldown(hostname) {
  const state = hostState.get(hostname);
  if (!state) return;
  const wait = state.until - Date.now();
  if (wait <= 0) return;
  const cap = bulkImportContext.getStore() ? wait : Math.min(wait, INTERACTIVE_MAX_WAIT_MS);
  await new Promise((r) => setTimeout(r, cap));
}

function registerRateLimit(hostname) {
  const state = hostState.get(hostname) || { until: 0, backoff: BASE_COOLDOWN_MS };
  const backoff = Math.min(state.backoff, MAX_COOLDOWN_MS);
  hostState.set(hostname, { until: Date.now() + backoff, backoff: Math.min(backoff * 2, MAX_COOLDOWN_MS) });
}

function registerSuccess(hostname) {
  if (hostState.has(hostname)) hostState.delete(hostname);
}

// Wikipedia/Wikidata/TVmaze occasionally return a transient 429/5xx under load. Without a
// retry, that single hiccup gets treated as "this show/movie genuinely has no cast/poster"
// and cached as such for a full day (see STALE_MS) — a couple of short retries turns a
// rare transient failure into a non-issue instead of visibly degraded content.
//
// Plain fetch() has no timeout: a single connection that never resolves (dropped packet,
// a proxy silently swallowing the request) hangs that call — and everything sequenced after
// it — forever. A bulk import doing hundreds of these sequentially turned that from a
// theoretical risk into an observed multi-minute stall, so every attempt gets a hard cap.
export async function fetchWithRetry(url, options = {}, retries = 4) {
  const hostname = hostnameOf(url);
  const startedAt = Date.now();
  const cooldownWait = hostState.get(hostname)?.until - Date.now();
  await waitForCooldown(hostname);
  if (cooldownWait > 0) debugLog('http', `${hostname}: attente de ${Math.round(Math.max(cooldownWait, 0))}ms (cooldown après rate-limit) avant ${url}`);

  let lastResp;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const resp = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (resp.ok || !RETRYABLE_STATUSES.has(resp.status)) {
        registerSuccess(hostname);
        debugLog('http', `${options.method || 'GET'} ${url} -> ${resp.status} en ${Date.now() - startedAt}ms (essai ${attempt + 1}/${retries + 1})`);
        return resp;
      }
      lastResp = resp;
      debugLog('http', `${options.method || 'GET'} ${url} -> ${resp.status} (essai ${attempt + 1}/${retries + 1})`);
      if (attempt < retries) {
        if (resp.status === 429) {
          // This used to wait a fixed, short, independently-guessed delay (capped at
          // MAX_RETRY_DELAY_MS) between attempts — completely disconnected from the circuit
          // breaker's own cooldown timestamp below. On a host that hands out ~20s cooldowns, that
          // meant retrying every 1-3s straight into a wall that hadn't cleared yet, burning
          // through all 5 attempts in ~10-15s and giving up right as the real cooldown was about
          // to end. Waiting on the *same* cooldown the circuit breaker just registered — not a
          // separate guess — means a retry only happens once there's an actual chance it lands.
          registerRateLimit(hostname);
          await waitForCooldown(hostname);
        } else {
          // Wikimedia sometimes asks for a very long Retry-After (a minute+) after a burst of
          // requests — honoring that literally would make a single item block the whole import
          // for minutes. Cap it: better to fail this one item fast and let the "incomplete
          // cache" retry logic pick it up again later than to stall everything else behind it.
          const retryAfter = Number(resp.headers.get('retry-after'));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, MAX_RETRY_DELAY_MS)
            : 500 * 2 ** attempt;
          await new Promise((r) => setTimeout(r, delay));
        }
      } else if (resp.status === 429) {
        registerRateLimit(hostname);
      }
    } catch (e) {
      clearTimeout(timer);
      lastError = e;
      debugLog('http', `${options.method || 'GET'} ${url} a échoué : ${e.message} (essai ${attempt + 1}/${retries + 1})`);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  }
  debugLog('http', `${options.method || 'GET'} ${url} abandonné après ${Date.now() - startedAt}ms`);
  if (lastResp) return lastResp;
  throw lastError;
}
