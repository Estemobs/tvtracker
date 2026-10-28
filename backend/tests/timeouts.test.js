import { describe, it, expect } from 'vitest';
import { REQUEST_TIMEOUT_MS, HEADERS_TIMEOUT_MS } from '../src/utils/timeouts.js';

describe('server timeouts', () => {
  it('keeps finite request timeouts instead of disabling them', () => {
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(HEADERS_TIMEOUT_MS).toBeGreaterThan(0);
    expect(HEADERS_TIMEOUT_MS).toBeLessThan(REQUEST_TIMEOUT_MS);
  });
});
