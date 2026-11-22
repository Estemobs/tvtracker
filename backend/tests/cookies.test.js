import { describe, it, expect } from 'vitest';
import { authCookieOptions, SESSION_COOKIE } from '../src/utils/cookies.js';

describe('authCookieOptions', () => {
  it('uses an httpOnly, same-site, root-scoped session cookie', () => {
    const options = authCookieOptions({});

    expect(SESSION_COOKIE).toBe('tvtracker_session');
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.maxAge).toBe(30 * 24 * 60 * 60 * 1000);
    expect(options.secure).toBe(false);
  });

  it('enables Secure only when COOKIE_SECURE is set', () => {
    expect(authCookieOptions({ COOKIE_SECURE: '1' }).secure).toBe(true);
    expect(authCookieOptions({ COOKIE_SECURE: 'true' }).secure).toBe(true);
    expect(authCookieOptions({ COOKIE_SECURE: '0' }).secure).toBe(false);
  });
});
