import { describe, it, expect } from 'vitest';
import { createTutorialTargets, TUTORIAL_ANCHORS, type MeasurableNode } from './targets';
import { HUD_SPOTLIGHT_SELECTORS } from './focus';

const node = (x: number, y: number, w: number, h: number): MeasurableNode => ({
  measureInWindow: (cb) => cb(x, y, w, h),
});

describe('TUTORIAL_ANCHORS', () => {
  it('is exactly the web HUD selector allow-list (shared anchor-id namespace)', () => {
    expect(new Set(Object.values(TUTORIAL_ANCHORS))).toEqual(new Set(HUD_SPOTLIGHT_SELECTORS));
  });
});

describe('createTutorialTargets', () => {
  it('measures every node registered under an anchor and drops 0-sized ones', async () => {
    const t = createTutorialTargets();
    t.register(TUTORIAL_ANCHORS.market, node(10, 20, 300, 80));
    t.register(TUTORIAL_ANCHORS.market, node(0, 0, 0, 0)); // not laid out yet
    expect(await t.measure(TUTORIAL_ANCHORS.market)).toEqual([{ x: 10, y: 20, w: 300, h: 80 }]);
  });

  it('unregister removes the node; unknown anchors measure empty', async () => {
    const t = createTutorialTargets();
    const un = t.register(TUTORIAL_ANCHORS.deck, node(1, 2, 3, 4));
    un();
    expect(await t.measure(TUTORIAL_ANCHORS.deck)).toEqual([]);
    expect(await t.measure('.never-registered')).toEqual([]);
  });

  it('survives a node whose measureInWindow throws', async () => {
    const t = createTutorialTargets();
    t.register(TUTORIAL_ANCHORS.hand, {
      measureInWindow: () => {
        throw new Error('detached');
      },
    });
    expect(await t.measure(TUTORIAL_ANCHORS.hand)).toEqual([]);
  });
});
