import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '../i18n';
import { MapPreview } from './MapPreview';

describe('MapPreview', () => {
  it('renders one circle per city and one line per route', () => {
    const { container } = render(
      <MapPreview
        draft={{
          cities: [
            { id: 'a', x: 10, y: 10 },
            { id: 'b', x: 90, y: 90 },
          ],
          routes: [{ a: 'a', b: 'b' }],
        }}
      />,
    );
    expect(container.querySelectorAll('circle')).toHaveLength(2);
    expect(container.querySelectorAll('line')).toHaveLength(1);
  });

  it('renders an empty-state message for an empty draft', () => {
    const { getByText } = render(<MapPreview draft={{ cities: [], routes: [] }} />);
    expect(getByText('尚無內容')).toBeInTheDocument();
  });

  it('renders the land silhouette and sizes the viewBox to it when geography is present', () => {
    const { container } = render(
      <MapPreview
        draft={{
          cities: [{ id: 'a', x: 10, y: 10 }],
          routes: [],
          geography: {
            baseView: { x: 0, y: 0, w: 50, h: 50 },
            land: [
              [
                [5, 5],
                [45, 5],
                [45, 45],
                [5, 45],
              ],
            ],
            crop: { lonMin: 0, lonMax: 1, latMin: 0, latMax: 1 },
          },
        }}
      />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 50 50');
    expect(container.querySelectorAll('path.land')).toHaveLength(1);
    expect(container.querySelector('rect.sea')).toBeInTheDocument();
  });

  it('caps the graticule on a hostile baseView instead of hanging', () => {
    // Both failure modes of an unbounded grid walk: a span no loop could finish, and coordinates
    // so large that a fixed step falls below the float ULP and never advances.
    for (const baseView of [
      { x: 0, y: 0, w: 1e12, h: 1e12 },
      { x: 1e300, y: 1e300, w: 1e300, h: 1e300 },
    ]) {
      const { container, unmount } = render(
        <MapPreview
          draft={{
            cities: [{ id: 'a', x: 10, y: 10 }],
            routes: [],
            geography: {
              baseView,
              land: [],
              crop: { lonMin: 0, lonMax: 1, latMin: 0, latMax: 1 },
            },
          }}
        />,
      );
      const lines = container.querySelectorAll('g.graticule line');
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.length).toBeLessThanOrEqual(2000);
      unmount();
    }
  });

  it('falls back to a plain 0-100 viewBox with no background when geography is absent', () => {
    const { container } = render(
      <MapPreview draft={{ cities: [{ id: 'a', x: 10, y: 10 }], routes: [] }} />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 100 100');
    expect(container.querySelectorAll('path.land')).toHaveLength(0);
    expect(container.querySelector('rect.sea')).not.toBeInTheDocument();
  });
});
