import { describe, it, expect } from 'vitest';
import { OFFICIAL_MAPS } from '@trm/map-data';
import { firstOfficialMapId, officialMapOptions } from '../src/game/officialMaps';

const ALL = OFFICIAL_MAPS.map((m) => m.mapId);

describe('officialMapOptions', () => {
  it('offers every bundled map before the server list arrives', () => {
    expect(officialMapOptions(null, 'zh-Hant').map((o) => o.mapId)).toEqual(ALL);
  });

  it('offers only the maps the server says are enabled', () => {
    expect(officialMapOptions(['taipei'], 'zh-Hant').map((o) => o.mapId)).toEqual(['taipei']);
  });

  it('keeps a switched-off map that the room is already set to, so the picker is never blank', () => {
    const ids = officialMapOptions(['taipei'], 'zh-Hant', 'taiwan').map((o) => o.mapId);
    expect(ids).toContain('taiwan');
    expect(ids).toContain('taipei');
  });

  it('drops an unknown enabled id rather than inventing an option for it', () => {
    expect(officialMapOptions(['not-a-map'], 'zh-Hant')).toEqual([]);
  });

  it('labels in the active locale', () => {
    const [zh] = officialMapOptions(['taiwan'], 'zh-Hant');
    const [en] = officialMapOptions(['taiwan'], 'en');
    expect(zh?.label).toBe(OFFICIAL_MAPS[0]!.content.meta.nameZh);
    expect(en?.label).toBe(OFFICIAL_MAPS[0]!.content.meta.nameEn);
  });

  it('credits a community-authored map in its label (both locales)', () => {
    const [zh] = officialMapOptions(['taipei-transit'], 'zh-Hant');
    const [en] = officialMapOptions(['taipei-transit'], 'en');
    expect(zh?.label).toBe('大臺北軌道交通（嶼翼）');
    expect(en?.label).toContain('嶼翼');
    expect(zh?.author).toBe('嶼翼');
    // `name` is the same string without the credit, for pickers that render it as its own element.
    expect(zh?.name).toBe('大臺北軌道交通');
  });

  it('states network size, so a picker can show it before the map is chosen', () => {
    const [taiwan] = officialMapOptions(['taiwan'], 'zh-Hant');
    expect(taiwan?.cities).toBe(OFFICIAL_MAPS[0]!.content.cities.length);
    expect(taiwan?.routes).toBe(OFFICIAL_MAPS[0]!.content.routes.length);
    expect(taiwan?.cities).toBeGreaterThan(0);
  });
});

describe('firstOfficialMapId', () => {
  it('picks the first still-enabled map for the source switch', () => {
    expect(firstOfficialMapId(null)).toBe(ALL[0]);
    expect(firstOfficialMapId(['taipei'])).toBe('taipei');
    expect(firstOfficialMapId([])).toBeUndefined();
  });
});
