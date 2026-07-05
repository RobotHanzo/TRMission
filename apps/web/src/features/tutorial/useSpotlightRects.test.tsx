import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSpotlightRects } from './useSpotlightRects';

describe('useSpotlightRects', () => {
  it('returns an empty array for a whole-board spotlight', () => {
    const { result } = renderHook(() => useSpotlightRects({ kind: 'board' }));
    expect(result.current).toEqual([]);
  });
  it('returns an empty array when targets are absent from the DOM', () => {
    const { result } = renderHook(() => useSpotlightRects({ kind: 'cities', ids: ['nowhere'] }));
    expect(result.current).toEqual([]);
  });
  it('skips zero-sized rects (jsdom has no layout)', () => {
    const el = document.createElement('div');
    el.setAttribute('data-city-id', 'taipei');
    document.body.appendChild(el);
    const { result } = renderHook(() => useSpotlightRects({ kind: 'cities', ids: ['taipei'] }));
    expect(result.current).toEqual([]); // getBoundingClientRect is 0x0 in jsdom
    el.remove();
  });
});
