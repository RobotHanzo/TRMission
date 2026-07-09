import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { CardColor, GameSnapshotSchema, Phase } from '@trm/proto';
import '../i18n';
import { GameStage } from './GameStage';
import { useGame } from '../store/game';

vi.mock('../hooks/useAnimationDriver', () => ({ useAnimationDriver: vi.fn() }));

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

// Same as above but with a hand that can pay for R16 (claim) or a first station (build) purely
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
        actionGate={{ t: 'CLAIM_ROUTE', routeId: 'R16' }}
      />,
    );
    fireEvent.click(document.querySelector('[data-route-id="R6"]')!);
    expect(paymentModal()).toBeNull();
    fireEvent.click(document.querySelector('[data-route-id="R16"]')!);
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
        actionGate={{ t: 'CLAIM_ROUTE', routeId: 'R16' }}
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
    expect(document.querySelector('[data-route-id="R16"]')!.classList.contains('claimable')).toBe(
      false,
    );
    fireEvent.click(document.querySelector('[data-route-id="R16"]')!);
    expect(paymentModal()).toBeNull();
  });

  it('the payment dialog carries the .payment-options list the coachmark spotlights', () => {
    render(
      <GameStage
        snapshot={payableSnap()}
        commands={null}
        onLeave={() => {}}
        sandbox
        actionGate={{ t: 'CLAIM_ROUTE', routeId: 'R16' }}
      />,
    );
    fireEvent.click(document.querySelector('[data-route-id="R16"]')!);
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
        actionGate={{ t: 'CLAIM_ROUTE', routeId: 'R16' }}
        onPendingClaim={onPendingClaim}
      />,
    );
    expect(onPendingClaim).toHaveBeenLastCalledWith(null);
    fireEvent.click(document.querySelector('[data-route-id="R16"]')!);
    expect(onPendingClaim).toHaveBeenLastCalledWith('route');
    fireEvent.click(document.querySelector('.modal-backdrop')!); // cancel
    expect(onPendingClaim).toHaveBeenLastCalledWith(null);
  });
});
