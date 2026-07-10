import { describe, it, expect } from 'vitest';
import { zoomBucket } from './lod';

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
