// The TV Time import returns 202 immediately and continues in the background, so the HTTP
// request itself only needs to cover the archive upload. Keep finite values to avoid Slowloris.
export const REQUEST_TIMEOUT_MS = 300_000;
export const HEADERS_TIMEOUT_MS = 65_000;
