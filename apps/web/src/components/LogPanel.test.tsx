import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase } from '@trm/proto';
import '../i18n';
import { LogPanel } from './LogPanel';
import { useLog } from '../store/log';
import { useGame } from '../store/game';
import { TICKETS } from '../game/content';

beforeEach(() => {
  useLog.getState().reset();
  useGame.setState({
    snapshot: create(GameSnapshotSchema, {
      stateVersion: 1,
      phase: Phase.AWAIT_ACTION,
      currentPlayerId: 'p1',
      turnOrder: ['p1', 'p2'],
      players: [
        { id: 'p1', seat: 0, trainCars: 45, stationsRemaining: 3 },
        { id: 'p2', seat: 1, trainCars: 45, stationsRemaining: 3 },
      ],
    }),
  });
});

describe('LogPanel', () => {
  it('shows the empty state with no entries', () => {
    render(<LogPanel />);
    expect(screen.getByText('尚無動作')).toBeInTheDocument();
  });

  it('renders a highlighted route-claimed line', () => {
    useLog.setState({
      entries: [
        {
          id: 1,
          kind: 'routeClaimed',
          playerId: 'p1',
          data: { routeId: 'X', points: 7 },
          importance: 'highlight',
        },
      ],
      nextId: 2,
    });
    render(<LogPanel />);
    // P1 fallback name (no roster) + points; importance class present.
    expect(screen.getByText(/P1/)).toBeInTheDocument();
    expect(document.querySelector('.log-line.log-highlight')).not.toBeNull();
  });

  it('renders a ticket-completed line with the resolved cities and points', () => {
    const ticket = TICKETS[0]!;
    useLog.setState({
      entries: [
        {
          id: 1,
          kind: 'ticketCompleted',
          playerId: 'p1',
          data: { ticketId: ticket.id },
          importance: 'highlight',
        },
      ],
      nextId: 2,
    });
    render(<LogPanel />);
    expect(document.querySelector('.log-line.log-highlight')).not.toBeNull();
    expect(screen.getByText(new RegExp(`\\+${ticket.value}`))).toBeInTheDocument();
  });

  it('renders the taken face-up locomotive chip as the rainbow gradient, not a flat hex', () => {
    useLog.setState({
      entries: [
        {
          id: 1,
          kind: 'tookFaceup',
          playerId: 'p1',
          data: { color: 'LOCOMOTIVE' },
          importance: 'normal',
        },
      ],
      nextId: 2,
    });
    render(<LogPanel />);
    const chip = document.querySelector('.log-chip') as HTMLElement;
    expect(chip.style.background).toContain('linear-gradient');
  });
});
