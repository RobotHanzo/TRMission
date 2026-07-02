import { describe, it, expect } from 'vitest';
import { validateGeography } from '@trm/map-data';
import { cropToGeography } from './world';

describe('cropToGeography', () => {
  it('returns null for an invalid crop', () => {
    expect(cropToGeography({ lonMin: 10, lonMax: 5, latMin: 0, latMax: 10 })).toBeNull();
  });

  it('crops Japan into a valid, engine-checkable MapGeography', () => {
    const result = cropToGeography({ lonMin: 128, lonMax: 146, latMin: 30, latMax: 46 });
    expect(result).not.toBeNull();
    const { geography, droppedRings } = result!;
    expect(geography.land.length).toBeGreaterThan(0);
    expect(droppedRings).toBe(0);
    expect(validateGeography(geography)).toEqual([]);
  });

  it('produces no land for an empty-ocean crop', () => {
    const result = cropToGeography({ lonMin: -170, lonMax: -160, latMin: -10, latMax: 0 });
    expect(result).not.toBeNull();
    expect(result!.geography.land).toEqual([]);
  });

  it('is deterministic for the same crop', () => {
    const crop = { lonMin: -10, lonMax: 5, latMin: 48, latMax: 60 };
    const a = cropToGeography(crop);
    const b = cropToGeography(crop);
    expect(a).toEqual(b);
  });
});
