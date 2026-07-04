import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema } from '@trm/proto';
import { Board } from './Board';

const snap = create(GameSnapshotSchema, {
  stateVersion: 1,
  players: [
    {
      id: 'p1',
      seat: 0,
      trainCars: 45,
      stationsRemaining: 3,
      routePoints: 0,
      handCount: 4,
      ticketCount: 2,
    },
  ],
  ownership: [],
  stations: [],
});

describe('Board', () => {
  it('renders the Taiwan map with the full route graph and localized city names', () => {
    const { container } = render(
      <Board
        snapshot={snap}
        locale="zh-Hant"
        colorBlind={false}
        canAct={false}
        onPickRoute={() => {}}
        onPickCity={() => {}}
      />,
    );
    expect(screen.getByRole('img', { name: /Taiwan/i })).toBeInTheDocument();
    // Every authored route draws a roadbed path plus a chain of car slots.
    expect(container.querySelectorAll('path.bed').length).toBeGreaterThan(60);
    expect(container.querySelectorAll('rect.slot').length).toBeGreaterThan(80);
    // Multi-route junctions render as slot-shaped hub stations.
    expect(container.querySelectorAll('rect.city-hub').length).toBeGreaterThan(0);
    // A known station label is present in Traditional Chinese.
    expect(screen.getAllByText('臺北').length).toBeGreaterThan(0);
  });

  it('renders random-event overlays driven by snapshot.random_events', () => {
    const eventSnap = create(GameSnapshotSchema, {
      stateVersion: 1,
      players: [
        {
          id: 'p1',
          seat: 0,
          trainCars: 45,
          stationsRemaining: 3,
          routePoints: 0,
          handCount: 4,
          ticketCount: 2,
        },
      ],
      ownership: [],
      stations: [],
      randomEvents: {
        mode: 'intense',
        roundIndex: 1,
        active: [{ id: 'e1', kind: 'SKY_LANTERN', routeIds: ['R3'] }],
        hotspots: [{ cityId: 'taipei', level: 2 }],
        charters: [
          {
            id: 'c1',
            cityA: 'taipei',
            cityB: 'kaohsiung',
            points: 10,
            expiresAfterRound: 5,
            wonByPlayerId: '',
          },
        ],
        reopenBonusRouteIds: ['R4'],
        closedRouteIds: ['R2'],
      },
    });
    const { container } = render(
      <Board
        snapshot={eventSnap}
        locale="zh-Hant"
        colorBlind={false}
        canAct={false}
        onPickRoute={() => {}}
        onPickCity={() => {}}
      />,
    );
    // Closed / sky-lantern / reopen route markers, keyed to the right routes.
    expect(container.querySelector('[data-route-id="R2"][data-closed="true"]')).toBeTruthy();
    expect(container.querySelector('[data-route-id="R3"][data-sky="true"]')).toBeTruthy();
    expect(container.querySelector('[data-route-id="R4"][data-reopen="true"]')).toBeTruthy();
    expect(container.querySelector('.evt-typhoon')).toBeTruthy();
    expect(container.querySelector('.evt-reopen-chip')).toBeTruthy();
    // Hotspot badge on the city, and charter chips on BOTH endpoints of the open charter.
    expect(container.querySelector('[data-city-id="taipei"][data-hotspot="2"]')).toBeTruthy();
    expect(container.querySelector('[data-city-id="taipei"][data-charter="true"]')).toBeTruthy();
    expect(container.querySelector('[data-city-id="kaohsiung"][data-charter="true"]')).toBeTruthy();
  });

  it('tags routes and cities with data attributes for the tutorial spotlight', () => {
    const { container } = render(
      <Board
        snapshot={snap}
        locale="zh-Hant"
        colorBlind={false}
        canAct={false}
        onPickRoute={() => {}}
        onPickCity={() => {}}
      />,
    );
    expect(container.querySelectorAll('[data-route-id]').length).toBeGreaterThan(60);
    expect(container.querySelector('[data-city-id="taipei"]')).toBeTruthy();
  });
});
