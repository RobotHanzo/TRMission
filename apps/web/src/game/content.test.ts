import { describe, it, expect } from 'vitest';
import { cityTier } from './content';

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
    expect(cityTier('zhunan')).toBe('tertiary');
    expect(cityTier('chaozhou')).toBe('tertiary');
  });

  it('defaults the smallest stations to minor', () => {
    expect(cityTier('jiji')).toBe('minor');
    expect(cityTier('chishang')).toBe('minor');
  });

  it('falls back to minor for an id outside the active content', () => {
    expect(cityTier('not-a-real-city')).toBe('minor');
  });
});
