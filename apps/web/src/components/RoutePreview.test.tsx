import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RoutePreview } from './RoutePreview';

const cityA = { id: 'a', x: 40, y: 40 };
const cityB = { id: 'b', x: 60, y: 60 };
const cities = [cityA, cityB];
const routes = [{ a: 'a', b: 'b' }];
const base = { x: 0, y: 0, w: 100, h: 100 };

describe('RoutePreview', () => {
  it('draws the Taiwan silhouette (relief) when geography is null', () => {
    const { container } = render(
      <RoutePreview
        a={cityA}
        b={cityB}
        cities={cities}
        routes={routes}
        geography={null}
        baseView={base}
        tone="short"
      />,
    );
    expect(container.querySelector('.rp-relief')).not.toBeNull();
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 100 100');
  });

  it('draws custom land rings and no Taiwan relief when geography is provided', () => {
    const geography = {
      baseView: base,
      crop: { lonMin: 0, lonMax: 1, latMin: 0, latMax: 1 },
      land: [[[0, 0], [20, 0], [20, 20], [0, 20]] as [number, number][]],
    };
    const { container } = render(
      <RoutePreview
        a={cityA}
        b={cityB}
        cities={cities}
        routes={routes}
        geography={geography}
        baseView={base}
        tone="short"
      />,
    );
    expect(container.querySelector('.rp-relief')).toBeNull();
    expect(container.querySelectorAll('.rp-geo .rp-land').length).toBe(1);
  });

  it('applies a per-ticket zoom view to the viewBox', () => {
    const { container } = render(
      <RoutePreview
        a={cityA}
        b={cityB}
        cities={cities}
        routes={routes}
        geography={null}
        baseView={base}
        view={{ mode: 'zoom', level: 1 }}
        tone="short"
      />,
    );
    // level 1 → 18×18 centered on (50,50)
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('41 41 18 18');
  });
});
