export const SESSION_COOKIE = 'tvtracker_session';
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function authCookieOptions(env = process.env) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE === '1' || env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  };
}
