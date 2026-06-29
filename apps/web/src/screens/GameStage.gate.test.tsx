import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

const deckButton = () => document.querySelector('.market .deck') as HTMLButtonElement;
const drawTicketsButton = () => screen.getByRole('button', { name: /抽任務卡/ });

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
});
