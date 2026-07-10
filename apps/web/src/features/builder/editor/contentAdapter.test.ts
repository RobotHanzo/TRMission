import { describe, it, expect } from 'vitest';
import { draftToContent } from './contentAdapter';
import type { MapDraft } from '../../../net/rest';

const draft = (bow?: number): MapDraft => ({
  cities: [],
  routes: [
    {
      id: 'r1',
      a: 'a',
      b: 'b',
      color: 'RED',
      length: 2,
      ferryLocos: 0,
      isTunnel: false,
      ...(bow !== undefined ? { bow } : {}),
    },
  ],
  tickets: [],
});

describe('draftToContent', () => {
  it('carries an authored route bow into content', () => {
    const content = draftToContent(draft(-2.5), { nameZh: 'x', nameEn: 'x' });
    expect(content.routes[0]!.bow).toBe(-2.5);
  });

  it('omits the key entirely when the draft has no bow', () => {
    const content = draftToContent(draft(), { nameZh: 'x', nameEn: 'x' });
    expect(Object.keys(content.routes[0]!)).not.toContain('bow');
  });

  it('carries an authored city tier into content', () => {
    const draftWithCity: MapDraft = {
      cities: [
        {
          id: 'a',
          nameZh: '甲',
          nameEn: 'A',
          x: 0,
          y: 0,
          region: 'r',
          isIsland: false,
          tier: 'major',
        },
      ],
      routes: [],
      tickets: [],
    };
    const content = draftToContent(draftWithCity, { nameZh: 'x', nameEn: 'x' });
    expect(content.cities[0]!.tier).toBe('major');
  });
});
