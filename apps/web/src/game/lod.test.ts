import { describe, it, expect } from 'vitest';
import {
  zoomBucket,
  cityTier,
  MAJOR_CITIES,
  SECONDARY_CITIES,
  TERTIARY_CITIES,
} from './lod';

describe('zoomBucket', () => {
  it('maps scale to four ascending level-of-detail buckets', () => {
    expect(zoomBucket(0.8)).toBe('far');
    expect(zoomBucket(1.24)).toBe('far');
    expect(zoomBucket(1.25)).toBe('regional');
    expect(zoomBucket(1.69)).toBe('regional');
    expect(zoomBucket(1.7)).toBe('district');
    expect(zoomBucket(2.39)).toBe('district');
    expect(zoomBucket(2.4)).toBe('local');
    expect(zoomBucket(8)).toBe('local');
  });

  it('keeps the home view (initialScale 1.9) at district, not full detail', () => {
    expect(zoomBucket(1.9)).toBe('district');
  });
});

describe('cityTier', () => {
  it('classifies hub + landmark cities as major', () => {
    expect(cityTier('taipei')).toBe('major');
    expect(cityTier('kaohsiung')).toBe('major');
    expect(cityTier('hengchun')).toBe('major');
  });

  it('classifies prominent metros / county seats as secondary', () => {
    expect(cityTier('taoyuan')).toBe('secondary');
    expect(cityTier('changhua')).toBe('secondary');
    expect(cityTier('pingtung')).toBe('secondary');
  });

  it('classifies district towns / junctions as tertiary', () => {
    expect(cityTier('zhongli')).toBe('tertiary');
    expect(cityTier('suao')).toBe('tertiary');
  });

  it('defaults the smallest stations to minor', () => {
    expect(cityTier('tamsui')).toBe('minor');
    expect(cityTier('toucheng')).toBe('minor');
  });

  it('assigns each tiered city to exactly one tier (no overlaps)', () => {
    const all = [...MAJOR_CITIES, ...SECONDARY_CITIES, ...TERTIARY_CITIES];
    expect(new Set(all).size).toBe(all.length);
  });
});
