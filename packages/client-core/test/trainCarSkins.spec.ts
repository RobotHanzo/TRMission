import { describe, expect, it } from 'vitest';
import { DEFAULT_TRAIN_CAR_SKIN } from '@trm/shared';
import { resolveTrainCarSkin, trainCarSkinOptions } from '../src/game/trainCarSkins';

describe('trainCarSkinOptions', () => {
  it('offers everything bundled while the list has not arrived', () => {
    expect(trainCarSkinOptions(null, 'en').map((o) => o.skin)).toEqual(['rollingStock', 'classic']);
  });

  it('offers only what a maintainer switched on, plus the default', () => {
    expect(trainCarSkinOptions([], 'en').map((o) => o.skin)).toEqual([DEFAULT_TRAIN_CAR_SKIN]);
    expect(trainCarSkinOptions(['classic'], 'en').map((o) => o.skin)).toEqual([
      'rollingStock',
      'classic',
    ]);
  });

  it('labels in the active locale', () => {
    expect(trainCarSkinOptions(null, 'en')[1]?.label).toBe('Classic carriage');
    expect(trainCarSkinOptions(null, 'zh-Hant')[1]?.label).toBe('經典車廂');
  });
});

describe('resolveTrainCarSkin', () => {
  it('draws the stored pack when it is on offer', () => {
    expect(resolveTrainCarSkin('classic', ['rollingStock', 'classic'])).toBe('classic');
    expect(resolveTrainCarSkin('classic', null)).toBe('classic');
  });

  it('falls back to the default for an unset, unknown, or switched-off pack', () => {
    expect(resolveTrainCarSkin(undefined, null)).toBe(DEFAULT_TRAIN_CAR_SKIN);
    expect(resolveTrainCarSkin('notAPack', null)).toBe(DEFAULT_TRAIN_CAR_SKIN);
    expect(resolveTrainCarSkin('classic', ['rollingStock'])).toBe(DEFAULT_TRAIN_CAR_SKIN);
  });

  it('never rejects the default itself, whatever the server says', () => {
    // The default is the fallback, so an availability list that somehow omits it must not leave
    // the card with no artwork at all.
    expect(resolveTrainCarSkin(DEFAULT_TRAIN_CAR_SKIN, [])).toBe(DEFAULT_TRAIN_CAR_SKIN);
  });
});
