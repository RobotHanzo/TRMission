import { describe, it, expect } from 'vitest';
import { validateGeography } from '@trm/map-data';
import { cropToGeography, countriesToGeography } from './world';
import { WORLD_COUNTRIES } from './worldCountries';

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

describe('countriesToGeography', () => {
  it('returns null for an empty selection', () => {
    expect(countriesToGeography([])).toBeNull();
  });

  it('returns null when no id matches', () => {
    expect(countriesToGeography(['ZZZ'])).toBeNull();
  });

  it('builds a valid geography for a single country', () => {
    const result = countriesToGeography(['JPN']);
    expect(result).not.toBeNull();
    const { geography, droppedRings } = result!;
    expect(geography.land.length).toBeGreaterThan(0);
    expect(droppedRings).toBe(0);
    expect(validateGeography(geography)).toEqual([]);
  });

  it('excludes a neighbour that falls inside the union bbox but was not selected', () => {
    const picked = countriesToGeography(['FRA', 'DEU']);
    expect(picked).not.toBeNull();
    // France + Germany's combined bounding box spans far wider than Western Europe: France's own
    // WORLD_COUNTRIES entry includes a French Guiana ring (lon ≈ -54°), which stretches the union
    // bbox to transatlantic scale. A rectangular crop over that same box therefore also picks up
    // unrelated West African coastline, Atlantic islands, and South American coastline that the
    // two-country selection correctly excludes — so it must produce strictly more land rings.
    const bboxCrop = cropToGeography(picked!.geography.crop);
    expect(bboxCrop).not.toBeNull();
    expect(bboxCrop!.geography.land.length).toBeGreaterThan(picked!.geography.land.length);
  });

  it("splices in the game's detailed Taiwan silhouette, not the crude admin-0 outline", () => {
    const crude = WORLD_COUNTRIES.find((c) => c.id === 'TWN')!;
    const result = countriesToGeography(['TWN']);
    expect(result).not.toBeNull();
    const main = result!.geography.land.reduce((a, b) => (b.length > a.length ? b : a));
    expect(main.length).toBeGreaterThan(crude.rings[0]!.length);
  });

  it('accepts a real high-latitude single-country selection (Greenland)', () => {
    const result = countriesToGeography(['GRL']);
    expect(result).not.toBeNull();
    expect(validateGeography(result!.geography)).toEqual([]);
  });

  it('is deterministic for the same selection', () => {
    const a = countriesToGeography(['ITA']);
    const b = countriesToGeography(['ITA']);
    expect(a).toEqual(b);
  });
});
