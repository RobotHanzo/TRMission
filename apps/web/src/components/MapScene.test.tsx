import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { buildRouteGeometryFor } from '@trm/map-data';
import { MapScene } from './MapScene';

const cities = [
  { id: 'a', x: 10, y: 10 },
  { id: 'b', x: 40, y: 10 },
  { id: 'c', x: 25, y: 40, isIsland: true },
];
const routes = [
  { id: 'r1', a: 'a', b: 'b', color: 'RED', length: 3, isTunnel: false, ferryLocos: 0 },
  { id: 'r2', a: 'b', b: 'c', color: 'GRAY', length: 2, isTunnel: false, ferryLocos: 1 },
];
const { geometry, hubs } = buildRouteGeometryFor(cities, routes);
const base = {
  cities,
  routes,
  geometry,
  hubs,
  view: { x: 0, y: 0, w: 50, h: 50 },
  geography: null,
} as const;

describe('MapScene', () => {
  it('renders the network with the exact board classes and data attributes', () => {
    const { container } = render(<MapScene {...base} />);
    expect(container.querySelector('svg.board')).toBeTruthy();
    expect(container.querySelectorAll('path.bed').length).toBe(2);
    expect(container.querySelectorAll('rect.slot:not(.ferry-loco)').length).toBe(3); // r1's cars
    expect(container.querySelectorAll('circle.ferry-pip').length).toBe(1); // r2: 2 slots − 1 loco
    expect(container.querySelectorAll('rect.slot.ferry-loco').length).toBe(1);
    expect(container.querySelector('[data-route-id="r1"]')).toBeTruthy();
    expect(container.querySelector('[data-city-id="c"] circle.city-dot')).toBeTruthy();
    expect(container.querySelector('[data-city-id="c"]')!.classList.contains('island')).toBe(true);
    // Nothing optional leaks in by default: no labels, no hit paths, no claim affordances.
    expect(container.querySelectorAll('text.city-label').length).toBe(0);
    expect(container.querySelectorAll('path.hit').length).toBe(0);
    expect(container.querySelectorAll('.claimable').length).toBe(0);
  });

  it('claim mode: hit + claimable only on unowned routes; owned ferry hides its rainbow', () => {
    const owned = new Map([['r2', { ownerSeat: 1 }]]);
    const { container } = render(
      <MapScene {...base} owned={owned} canAct onRouteClick={() => {}} />,
    );
    expect(container.querySelectorAll('path.hit').length).toBe(1); // r1 only
    expect(container.querySelector('[data-route-id="r1"]')!.classList.contains('claimable')).toBe(
      true,
    );
    expect(container.querySelector('[data-route-id="r2"]')!.classList.contains('owned')).toBe(
      true,
    );
    expect(container.querySelectorAll('rect.slot.ferry-loco').length).toBe(0);
  });

  it('labels, class hooks, and always-hit compose (the editor shape)', () => {
    const { container, getByText } = render(
      <MapScene
        {...base}
        cityLabel={(c) => c.id.toUpperCase()}
        cityClass={(c) => (c.id === 'a' ? 'editor-city editor-city--selected' : 'editor-city')}
        routeClass={() => 'editor-route'}
        alwaysHitRoutes
        cityHitArea="group"
      />,
    );
    expect(getByText('A')).toBeTruthy();
    expect(container.querySelectorAll('path.hit').length).toBe(2);
    expect(
      container.querySelector('[data-city-id="a"]')!.classList.contains('editor-city--selected'),
    ).toBe(true);
    expect(
      container.querySelector('[data-route-id="r1"]')!.classList.contains('editor-route'),
    ).toBe(true);
    expect(container.querySelectorAll('.claimable').length).toBe(0);
  });

  it('stations, glow seats, and ticket-target halos render like the board', () => {
    const { container } = render(
      <MapScene
        {...base}
        stations={new Map([['a', 2]])}
        glowingRoutes={new Map([['r1', 0]])}
        glowingStations={new Map([['a', 2]])}
        highlightCities={new Set(['b'])}
      />,
    );
    expect(container.querySelector('[data-city-id="a"] circle.station')).toBeTruthy();
    expect(container.querySelector('[data-city-id="a"] circle.station-ring')).toBeTruthy();
    expect(
      container.querySelector('[data-route-id="r1"]')!.classList.contains('just-claimed'),
    ).toBe(true);
    expect(container.querySelector('[data-city-id="b"]')!.classList.contains('ticket-target')).toBe(
      true,
    );
    expect(container.querySelector('[data-city-id="b"] circle.ticket-target-halo')).toBeTruthy();
  });
});
