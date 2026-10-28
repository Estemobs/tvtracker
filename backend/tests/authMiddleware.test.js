import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/jwt.js', () => ({ verifyToken: vi.fn() }));
vi.mock('../src/db/index.js', () => ({ db: { prepare: vi.fn() } }));

import { verifyToken } from '../src/utils/jwt.js';
import { db } from '../src/db/index.js';
import { requireAuth } from '../src/middleware/auth.js';

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

function makeReq({ cookies = {}, authorization } = {}) {
  return {
    cookies,
    headers: authorization ? { authorization } : {},
  };
}

describe('requireAuth', () => {
  let get;

  beforeEach(() => {
    vi.clearAllMocks();
    get = vi.fn();
    db.prepare.mockReturnValue({ get });
  });

  it('authenticates from the httpOnly session cookie', () => {
    verifyToken.mockReturnValue({ sub: 1 });
    get.mockReturnValue({ id: 1, status: 'active' });
    const req = makeReq({ cookies: { tvtracker_session: 'cookie-token' } });
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(verifyToken).toHaveBeenCalledWith('cookie-token');
    expect(req.user).toEqual({ id: 1, status: 'active' });
    expect(next).toHaveBeenCalledOnce();
  });

  it('falls back to Bearer when the cookie is stale', () => {
    verifyToken.mockImplementation((token) => {
      if (token === 'bearer-token') return { sub: 1 };
      throw new Error('invalid cookie');
    });
    get.mockReturnValue({ id: 1, status: 'active' });
    const req = makeReq({
      cookies: { tvtracker_session: 'stale-cookie' },
      authorization: 'Bearer bearer-token',
    });
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(req.user).toEqual({ id: 1, status: 'active' });
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects a request without credentials', () => {
    const res = makeRes();
    const next = vi.fn();

    requireAuth(makeReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an inactive user', () => {
    verifyToken.mockReturnValue({ sub: 1 });
    get.mockReturnValue({ id: 1, status: 'pending' });
    const res = makeRes();
    const next = vi.fn();

    requireAuth(makeReq({ cookies: { tvtracker_session: 'cookie-token' } }), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
