import { describe, it, expect } from 'vitest';
import { hostnameOf, mapWithLimit } from '../src/services/httpRetry.js';

describe('hostnameOf', () => {
  it('extracts hostname from a standard URL', () => {
    expect(hostnameOf('https://api.tvmaze.com/shows/1')).toBe('api.tvmaze.com');
  });

  it('extracts hostname with port', () => {
    expect(hostnameOf('http://localhost:3000/api')).toBe('localhost');
  });

  it('returns unknown for invalid URL', () => {
    expect(hostnameOf('not-a-url')).toBe('unknown');
  });
});

describe('mapWithLimit', () => {
  it('processes all items with concurrency limit', async () => {
    const items = [1, 2, 3, 4, 5];
    const fn = (x) => Promise.resolve(x * 2);
    const results = await mapWithLimit(items, 2, fn);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('handles empty array', async () => {
    const results = await mapWithLimit([], 2, (x) => Promise.resolve(x));
    expect(results).toEqual([]);
  });
});
