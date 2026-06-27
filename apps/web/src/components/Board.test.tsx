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
    // 90 routes are authored; each draws at least one <line>.
    expect(container.querySelectorAll('line').length).toBeGreaterThan(80);
    // A known station label is present in Traditional Chinese.
    expect(screen.getAllByText('臺北').length).toBeGreaterThan(0);
  });
});
