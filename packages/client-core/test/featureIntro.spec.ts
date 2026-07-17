import { describe, it, expect } from 'vitest';
import { TAIWAN_CONTENT, type GameContent } from '@trm/map-data';
import {
  introducedFeatureIntros,
  pendingFeatureIntros,
} from '../src/tutorial/featureIntro';

/** Taiwan content with its first route re-authored as a broken rail. */
const withBrokenRail = (): GameContent => ({
  ...TAIWAN_CONTENT,
  routes: TAIWAN_CONTENT.routes.map((r, i) => (i === 0 ? { ...r, brokenCarriages: 1 } : r)),
});

describe('featureIntro', () => {
  it('the default Taiwan map introduces nothing', () => {
    expect(introducedFeatureIntros(TAIWAN_CONTENT)).toEqual([]);
  });

  it('a map with a broken rail introduces the brokenRail intro', () => {
    const intros = introducedFeatureIntros(withBrokenRail());
    expect(intros.map((f) => f.key)).toEqual(['brokenRail']);
    expect(intros[0]!.pages.length).toBeGreaterThan(0);
  });

  it('pendingFeatureIntros filters what the user has already seen', () => {
    const content = withBrokenRail();
    expect(pendingFeatureIntros(content, undefined).map((f) => f.key)).toEqual(['brokenRail']);
    expect(pendingFeatureIntros(content, []).map((f) => f.key)).toEqual(['brokenRail']);
    expect(pendingFeatureIntros(content, ['brokenRail'])).toEqual([]);
  });
});
