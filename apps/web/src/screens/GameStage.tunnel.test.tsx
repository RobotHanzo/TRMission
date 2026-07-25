// A pending tunnel reveal covers the whole viewport, replay transport included — so in playback
// (no commands) it must be read-only AND closable, or stepping onto a TUNNEL_PENDING frame leaves
// the viewer stuck behind a dialog whose buttons resolve nothing (issue #45).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { CardColor, GameSnapshotSchema, Phase } from '@trm/proto';
import '../i18n';
import i18n from '../i18n';
import type { GameCommands } from '../net/commands';
import { useGame } from '../store/game';
import { GameStage } from './GameStage';

vi.mock('../hooks/useAnimationDriver', () => ({ useAnimationDriver: vi.fn() }));
vi.mock('../lib/analytics', () => ({ track: vi.fn() }));
vi.mock('../sound/player', () => ({
  soundPlayer: {
    play: vi.fn(),
    preload: vi.fn(),
    unlock: vi.fn(),
    setEnabled: vi.fn(),
    setVolume: vi.fn(),
  },
}));
// Reduced motion shows the surcharge result instantly, so the assertions don't wait out the
// card-flip reveal (whose timing is covered by TunnelModal.test.tsx).
vi.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

const resolveTunnel = vi.fn();
const commandSpies = () => ({ resolveTunnel }) as unknown as GameCommands;

// p0 claimed a tunnel and owes 2 more BLUE; the viewer IS p0, so a live game would offer them the
// interactive surcharge options (they hold 3 blue).
const tunnelSnap = () =>
  create(GameSnapshotSchema, {
    stateVersion: 7,
    phase: Phase.TUNNEL_PENDING,
    currentPlayerId: 'p0',
    turnOrder: ['p0', 'p1'],
    deckCount: 10,
    market: [CardColor.BLUE, CardColor.GREEN, CardColor.YELLOW, CardColor.BLACK],
    players: [
      { id: 'p0', seat: 0, trainCars: 45, stationsRemaining: 3, handCount: 3 },
      { id: 'p1', seat: 1, trainCars: 45, stationsRemaining: 3 },
    ],
    you: { playerId: 'p0', hand: { blue: 3 }, keptTicketIds: [], pendingOfferTicketIds: [] },
    pendingTunnel: {
      playerId: 'p0',
      routeId: 'r1',
      revealed: [CardColor.RED, CardColor.BLUE, CardColor.RED],
      extraRequired: 2,
      playedColor: CardColor.BLUE,
    },
  });

const dialog = () => screen.queryByRole('dialog');
const closeButton = () => screen.queryByRole('button', { name: i18n.t('close') });

beforeEach(() => {
  void i18n.changeLanguage('zh-Hant');
  resolveTunnel.mockClear();
  useGame.getState().reset();
  useGame.setState({ snapshot: tunnelSnap(), rejection: null });
});

describe('GameStage tunnel reveal in playback', () => {
  it('a replay reveal is read-only and closes on demand, without resolving anything', () => {
    render(<GameStage snapshot={tunnelSnap()} commands={null} onLeave={() => {}} sandbox />);
    expect(dialog()).not.toBeNull();
    // Read-only even though the viewed perspective is the claimant: no abort, no spend options.
    expect(screen.queryByRole('button', { name: i18n.t('abort') })).toBeNull();
    expect(document.querySelectorAll('.payment-options button')).toHaveLength(0);

    fireEvent.click(closeButton()!);
    expect(dialog()).toBeNull();
    expect(resolveTunnel).not.toHaveBeenCalled();
  });

  it('a live claimant still gets the interactive dialog, and no Close', () => {
    render(<GameStage snapshot={tunnelSnap()} commands={commandSpies()} onLeave={() => {}} />);
    expect(dialog()).not.toBeNull();
    expect(closeButton()).toBeNull();
    // The claimant's own way out stays the real action — it resolves the tunnel on the server.
    fireEvent.click(screen.getByRole('button', { name: i18n.t('abort') }));
    expect(resolveTunnel).toHaveBeenCalledWith(false);
  });
});
