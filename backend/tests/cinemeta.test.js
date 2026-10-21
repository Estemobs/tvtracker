import { describe, it, expect } from 'vitest';
import { mapMovie } from '../src/services/cinemeta.js';

describe('cinemeta mapMovie', () => {
  it('maps a search result (releaseInfo/genre shape)', () => {
    const movie = mapMovie({
      id: 'tt1375666',
      imdb_id: 'tt1375666',
      name: 'Inception',
      poster: 'https://images.metahub.space/poster/small/tt1375666/img',
      releaseInfo: '2010',
      imdbRating: '8.8',
      genre: ['Sci-Fi'],
    });

    expect(movie).toMatchObject({
      source: 'cinemeta',
      source_id: 'tt1375666',
      imdb_id: 'tt1375666',
      title: 'Inception',
      year: '2010',
      release_date: '2010',
      note: 8.8,
      genres: ['Sci-Fi'],
      poster: 'https://images.metahub.space/poster/medium/tt1375666/img',
    });
  });

  it('maps a detail sheet (released/genres/runtime/cast shape)', () => {
    const movie = mapMovie({
      id: 'tt1375666',
      imdb_id: 'tt1375666',
      name: 'Inception',
      poster: 'https://images.metahub.space/poster/small/tt1375666/img',
      background: 'https://images.metahub.space/background/medium/tt1375666/img',
      released: '2010-07-16T00:00:00.000Z',
      runtime: '2h 28m',
      imdbRating: '8.8',
      genres: ['Adventure', 'Sci-Fi'],
      cast: ['Leonardo DiCaprio'],
      description: 'A thief...',
    });

    expect(movie.duration).toBe(148);
    expect(movie.release_date).toBe('2010-07-16');
    expect(movie.backdrop).toContain('/background/');
    expect(movie.cast).toEqual([
      { person_id: null, actor: 'Leonardo DiCaprio', character: null, photo: null },
    ]);
  });

  it('keeps the IMDb id from `id` when imdb_id is absent', () => {
    expect(mapMovie({ id: 'tt0211915', name: 'Amélie' }).source_id).toBe('tt0211915');
  });
});
