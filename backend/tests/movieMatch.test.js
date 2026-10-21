import { describe, it, expect } from 'vitest';
import { pickRepairMatch } from '../src/services/movieMatch.js';

const jumanji = { source_id: 'tt2283362', title: 'Jumanji: Welcome to the Jungle', year: '2017' };
const jungle = { source_id: 'tt3758172', title: 'Jungle', year: '2017' };
const renfield = { source_id: 'tt11358390', title: 'Renfield', year: '2023' };
const rays = { source_id: 'tt36187539', title: 'The Rays and Shadows', year: '2026' };
const minions = { source_id: 'tt32890033', title: 'Minions & Monsters', year: '2026' };

describe('pickRepairMatch', () => {
  it('prefers an exact title with the same year', () => {
    expect(pickRepairMatch([renfield], 'Renfield', '2023')).toBe(renfield);
  });

  it('accepts the only exact title even when the cached year differs', () => {
    expect(pickRepairMatch([renfield], 'Renfield', '2022')).toBe(renfield);
  });

  it('accepts a localized title when only one result has the same year', () => {
    expect(pickRepairMatch([rays], 'Les Rayons et les Ombres', '2026')).toBe(rays);
  });

  it('trusts the top result for a localized title when several share its year', () => {
    expect(pickRepairMatch([jumanji, jungle], 'Jumanji : Bienvenue dans la jungle', '2017')).toBe(jumanji);
    expect(pickRepairMatch([rays, minions], 'Les Rayons et les Ombres', '2026')).toBe(rays);
  });

  it('refuses to guess when no result matches the year', () => {
    expect(pickRepairMatch([renfield, rays], 'Jumanji : Bienvenue dans la jungle', '2017')).toBeNull();
  });

  it('refuses ambiguous exact titles without a year', () => {
    expect(pickRepairMatch([jumanji, { ...jumanji, source_id: 'tt0000001' }], 'Jumanji: Welcome to the Jungle')).toBeNull();
  });
});
