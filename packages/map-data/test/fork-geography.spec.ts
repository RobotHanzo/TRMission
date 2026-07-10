import { describe, it, expect } from 'vitest';
import {
  taiwanForkGeography,
  validateGeography,
  validateContent,
  validateForPlay,
  OFFICIAL_MAPS,
  officialMapById,
  TAIWAN_OUTLINE,
  TAIWAN_ISLANDS,
} from '../src/index';
import type { GameContent } from '../src/index';

describe('taiwanForkGeography', () => {
  it('passes validateGeography', () => {
    expect(validateGeography(taiwanForkGeography())).toEqual([]);
  });

  it('has the main-island outline plus one ring per island blob, each a valid ring', () => {
    const geo = taiwanForkGeography();
    expect(geo.land).toHaveLength(1 + TAIWAN_ISLANDS.length);
    expect(geo.land[0]).toHaveLength(TAIWAN_OUTLINE.length);
    for (const ring of geo.land) expect(ring.length).toBeGreaterThanOrEqual(3);
  });

  it('rounds every land coordinate to 2 decimals (hash stability)', () => {
    for (const ring of taiwanForkGeography().land) {
      for (const [x, y] of ring) {
        expect(x).toBe(Math.round(x * 100) / 100);
        expect(y).toBe(Math.round(y * 100) / 100);
      }
    }
  });

  it('is deterministic across calls', () => {
    expect(taiwanForkGeography()).toEqual(taiwanForkGeography());
  });

  it('assembles Taiwan content + this geography into structurally-valid, playable content', () => {
    const taiwan = officialMapById('taiwan')!;
    const forked: GameContent = {
      meta: { mapId: 'custom:test', version: 1, nameZh: 'x', nameEn: 'x' },
      cities: taiwan.content.cities,
      routes: taiwan.content.routes,
      tickets: taiwan.content.tickets,
      geography: taiwanForkGeography(),
    };
    expect(validateContent(forked).errors).toEqual([]);
    expect(validateForPlay(forked, {}, 5).errors).toEqual([]);
  });

  it('exposes forkGeography on the official Taiwan registry entry', () => {
    expect(OFFICIAL_MAPS[0]!.forkGeography).toEqual(taiwanForkGeography());
    expect(officialMapById('taiwan')!.forkGeography).toBeDefined();
  });
});
