// A toggleable, in-memory log ring buffer surfaced in the admin panel — for diagnosing issues
// (a page stuck loading, a slow/failing external API) without shell access to `docker logs`.
// Off by default: instrumented call sites (httpRetry, explore trending) check isDebugEnabled()
// before doing any work, so this has ~zero cost when nobody's debugging. Resets on restart —
// it's meant to be switched on right before reproducing a problem, not a permanent audit log.
const MAX_LOGS = 300;
let enabled = false;
let logs = [];

export function isDebugEnabled() {
  return enabled;
}

export function setDebugEnabled(value) {
  enabled = !!value;
  logs = [];
  if (enabled) log('debug', 'Mode debug activé.');
}

export function log(scope, message) {
  if (!enabled) return;
  logs.push({ at: new Date().toISOString(), scope, message });
  if (logs.length > MAX_LOGS) logs.shift();
}

export function getLogs() {
  return logs;
}
