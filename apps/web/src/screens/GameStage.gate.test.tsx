import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { CardColor, GameSnapshotSchema, Phase } from '@trm/proto';
import '../i18n';
import { GameStage } from './GameStage';
import { useGame } from '../store/game';
import { useUi } from '../store/ui';
import { track } from '../lib/analytics';

vi.mock('../hooks/useAnimationDriver', () => ({ useAnimationDriver: vi.fn() }));
vi.mock('../lib/analytics', () => ({ track: vi.fn() }));

// My turn, AWAIT_ACTION, with cards in the deck/market and tickets to draw — so every action is
// otherwise legal and the ONLY thing that can disable a control is the tutorial action gate.
const myTurnSnap = () =>
  create(GameSnapshotSchema, {
    stateVersion: 1,
    phase: Phase.AWAIT_ACTION,
    currentPlayerId: 'p0',
    turnOrder: ['p0', 'p1'],
    deckCount: 10,
    ticketDeckShortCount: 5,
    market: [CardColor.RED, CardColor.BLUE, CardColor.GREEN, CardColor.YELLOW, CardColor.BLACK],
    players: [
      { id: 'p0', seat: 0, trainCars: 45, stationsRemaining: 3, handCount: 4 },
      { id: 'p1', seat: 1, trainCars: 45, stationsRemaining: 3 },
    ],
    you: { playerId: 'p0', hand: {}, keptTicketIds: [], pendingOfferTicketIds: [] },
  });

// Same as above but with a hand that can pay for the claim route or a first station (build) purely
// with locomotives, so a click that reaches the payment-enumeration step always succeeds.
const payableSnap = () =>
  create(GameSnapshotSchema, {
    stateVersion: 1,
    phase: Phase.AWAIT_ACTION,
    currentPlayerId: 'p0',
    turnOrder: ['p0', 'p1'],
    deckCount: 10,
    ticketDeckShortCount: 5,
    market: [CardColor.RED, CardColor.BLUE, CardColor.GREEN, CardColor.YELLOW, CardColor.BLACK],
    players: [
      { id: 'p0', seat: 0, trainCars: 45, stationsRemaining: 3, handCount: 2 },
      { id: 'p1', seat: 1, trainCars: 45, stationsRemaining: 3 },
    ],
    you: {
      playerId: 'p0',
      hand: { locomotive: 2 },
      keptTicketIds: [],
      pendingOfferTicketIds: [],
    },
  });

const deckButton = () => document.querySelector('.market .deck') as HTMLButtonElement;
const drawTicketsButton = () => screen.getByRole('button', { name: /抽任務卡/ });
const paymentModal = () => document.querySelector('.modal');
// The clickable element is the inner marker (a hub `<rect>` or a plain `<circle>`), not the outer
// `<g data-city-id>` group — city clicks default to per-marker hit areas (see MapScene's
// `cityHitArea`).
const cityMarker = (id: string) =>
  document.querySelector(`[data-city-id="${id}"] .city-dot, [data-city-id="${id}"] .city-hub`)!;

describe('GameStage tutorial action gate wiring', () => {
  beforeEach(() => {
    useGame.setState({ snapshot: myTurnSnap(), rejection: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it('with no gate (live game) the draw and draw-tickets controls are interactive', () => {
    render(<GameStage snapshot={myTurnSnap()} commands={null} onLeave={() => {}} sandbox />);
    expect(deckButton()).toBeEnabled();
    expect(drawTicketsButton()).toBeEnabled();
  });

  it('a locked gate (a narration / info beat) disables every action control', () => {
    render(
      <GameStage
        snapshot={myTurnSnap()}
        commands={null}
        onLeave={() => {}}
        sandbox
        actionGate="locked"
      />,
    );
    expect(deckButton()).toBeDisabled();
    expect(drawTicketsButton()).toBeDisabled();
  });

  it('an await gate enables only its action — drawing a card, but not drawing tickets', () => {
    render(
      <GameStage
        snapshot={myTurnSnap()}
        commands={null}
        onLeave={() => {}}
        sandbox
        actionGate={{ t: 'DRAW_ANY' }}
      />,
    );
    expect(deckButton()).toBeEnabled();
    expect(drawTicketsButton()).toBeDisabled();
  });

  it('a CLAIM_ROUTE gate naming one route ignores a click on a different route', () => {
    render(
      <GameStage
        snapshot={payableSnap()}
        commands={null}
        onLeave={() => {}}
        sandbox
        actionGate={{ t: 'CLAIM_ROUTE', routeId: 'R42' }}
      />,
    );
    fireEvent.click(document.querySelector('[data-route-id="R1"]')!);
    expect(paymentModal()).toBeNull();
    fireEvent.click(document.querySelector('[data-route-id="R42"]')!);
    expect(paymentModal()).not.toBeNull();
  });

  it('a BUILD_STATION gate naming one city ignores a click on a different city', () => {
    render(
      <GameStage
        snapshot={payableSnap()}
        commands={null}
        onLeave={() => {}}
        sandbox
        actionGate={{ t: 'BUILD_STATION', cityId: 'taipei' }}
      />,
    );
    fireEvent.click(cityMarker('banqiao'));
    expect(paymentModal()).toBeNull();
    fireEvent.click(cityMarker('taipei'));
    expect(paymentModal()).not.toBeNull();
  });

  it('a CLAIM_ROUTE gate leaves every city un-clickable (not just the wrong-station case)', () => {
    render(
      <GameStage
        snapshot={payableSnap()}
        commands={null}
        onLeave={() => {}}
        sandbox
        actionGate={{ t: 'CLAIM_ROUTE', routeId: 'R42' }}
      />,
    );
    expect(cityMarker('taipei').classList.contains('buildable')).toBe(false);
    fireEvent.click(cityMarker('taipei'));
    expect(paymentModal()).toBeNull();
  });

  it('a BUILD_STATION gate leaves every route un-clickable (not just the wrong-route case)', () => {
    render(
      <GameStage
        snapshot={payableSnap()}
        commands={null}
        onLeave={() => {}}
        sandbox
        actionGate={{ t: 'BUILD_STATION', cityId: 'taipei' }}
      />,
    );
    expect(document.querySelector('[data-route-id="R42"]')!.classList.contains('claimable')).toBe(
      false,
    );
    fireEvent.click(document.querySelector('[data-route-id="R42"]')!);
    expect(paymentModal()).toBeNull();
  });

  it('the payment dialog carries the .payment-options list the coachmark spotlights', () => {
    render(
      <GameStage
        snapshot={payableSnap()}
        commands={null}
        onLeave={() => {}}
        sandbox
        actionGate={{ t: 'CLAIM_ROUTE', routeId: 'R42' }}
      />,
    );
    fireEvent.click(document.querySelector('[data-route-id="R42"]')!);
    expect(document.querySelector('.payment-options')).not.toBeNull();
  });

  it('calls onPendingClaim as the payment dialog opens and closes', () => {
    const onPendingClaim = vi.fn();
    render(
      <GameStage
        snapshot={payableSnap()}
        commands={null}
        onLeave={() => {}}
        sandbox
        actionGate={{ t: 'CLAIM_ROUTE', routeId: 'R42' }}
        onPendingClaim={onPendingClaim}
      />,
    );
    expect(onPendingClaim).toHaveBeenLastCalledWith(null);
    fireEvent.click(document.querySelector('[data-route-id="R42"]')!);
    expect(onPendingClaim).toHaveBeenLastCalledWith('route');
    fireEvent.click(document.querySelector('.modal-backdrop')!); // cancel
    expect(onPendingClaim).toHaveBeenLastCalledWith(null);
  });
});

// A finished game: p0 (human) beats bot:1, with a longest-path bonus.
const gameOverSnap = () =>
  create(GameSnapshotSchema, {
    stateVersion: 9,
    phase: Phase.GAME_OVER,
    currentPlayerId: '',
    turnOrder: ['p0', 'bot:1'],
    players: [
      { id: 'p0', seat: 0, trainCars: 5, stationsRemaining: 3 },
      { id: 'bot:1', seat: 1, trainCars: 2, stationsRemaining: 1 },
    ],
    you: { playerId: 'p0', hand: {}, keptTicketIds: [], pendingOfferTicketIds: [] },
    gameSettings: { eventsMode: 'off' },
    finalScores: {
      players: [
        { playerId: 'p0', total: 87, ticketsCompleted: 3, longestBonus: 10 },
        { playerId: 'bot:1', total: 40, ticketsCompleted: 1, longestBonus: 0 },
      ],
      ranking: [{ playerIds: ['p0'] }, { playerIds: ['bot:1'] }],
    },
  });

describe('GameStage analytics gating', () => {
  beforeEach(() => {
    useGame.setState({ rejection: null });
    vi.mocked(track).mockClear();
  });
  afterEach(() => {
    useUi.setState({ gameId: null, isPractice: false });
    vi.restoreAllMocks();
  });

  it('sandbox play fires NO gameplay events even at GAME_OVER', () => {
    useUi.setState({ gameId: 'g1' });
    render(<GameStage snapshot={gameOverSnap()} commands={null} onLeave={() => {}} sandbox />);
    expect(track).not.toHaveBeenCalledWith('game_start', expect.anything());
    expect(track).not.toHaveBeenCalledWith('game_complete', expect.anything());
  });

  it('a live game fires game_start and game_complete once each, with derived params', () => {
    useUi.setState({ gameId: 'g2' });
    const { rerender } = render(
      <GameStage snapshot={gameOverSnap()} commands={null} onLeave={() => {}} />,
    );
    // A re-render with the same GAME_OVER snapshot must not double-fire.
    rerender(<GameStage snapshot={gameOverSnap()} commands={null} onLeave={() => {}} />);

    const names = vi.mocked(track).mock.calls.map((c) => c[0]);
    expect(names.filter((n) => n === 'game_start')).toHaveLength(1);
    expect(names.filter((n) => n === 'game_complete')).toHaveLength(1);

    const complete = vi.mocked(track).mock.calls.find((c) => c[0] === 'game_complete');
    expect(complete?.[1]).toMatchObject({
      won: true,
      final_score: 87,
      player_count: 2,
      bot_count: 1,
      tickets_completed: 3,
      longest_path: true,
      is_spectator: false,
    });
  });
});
