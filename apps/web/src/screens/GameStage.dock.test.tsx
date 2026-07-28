import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { CardColor, GameSnapshotSchema, Phase } from '@trm/proto';
import '../i18n';
import { GameStage } from './GameStage';
import { PHONE_QUERY } from '../hooks/useMediaQuery';
import { ticketById } from '../game/content';
import { useGame } from '../store/game';

vi.mock('../hooks/useAnimationDriver', () => ({ useAnimationDriver: vi.fn() }));

// jsdom has no matchMedia; pretend to be a phone — PHONE_QUERY matches, the wide query doesn't.
const phoneMatchMedia = (query: string): MediaQueryList =>
  ({
    matches: query === PHONE_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;

const baseSnap = (randomEvents?: MessageInitShape<typeof GameSnapshotSchema>['randomEvents']) =>
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
    ...(randomEvents ? { randomEvents } : {}),
  });

const dockTablist = () => screen.queryByRole('tablist', { name: '遊戲面板切換' });

describe('GameStage phone dock (live game at ≤700px)', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', phoneMatchMedia);
    useGame.setState({ snapshot: baseSnap(), rejection: null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the board above a tabbed dock, with no hand strip', () => {
    render(<GameStage snapshot={baseSnap()} commands={null} onLeave={() => {}} />);
    expect(document.querySelector('.game--dock')).not.toBeNull();
    expect(dockTablist()).toBeInTheDocument();
    expect(document.querySelector('.game-hand-strip')).toBeNull();
    // The hand panel is the default tab.
    expect(document.querySelector('.dock-panel .tray-section')).not.toBeNull();
  });

  it('switches panels through the dock tabs', () => {
    render(<GameStage snapshot={baseSnap()} commands={null} onLeave={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: /任務卡/ }));
    expect(document.querySelector('.dock-panel .tray-missions')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '抽牌' }));
    expect(document.querySelector('.dock-panel .market')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '玩家' }));
    expect(document.querySelector('.dock-panel .trackers')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '紀錄 · 聊天' }));
    expect(document.querySelector('.dock-panel .comms')).not.toBeNull();
  });

  it('heads the players panel with its title and the tap-for-details hint (issue #66)', () => {
    render(<GameStage snapshot={baseSnap()} commands={null} onLeave={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: '玩家' }));
    const head = document.querySelector('.dock-panel .tray-head');
    expect(head?.textContent).toContain('玩家');
    expect(head?.textContent).toContain('點一下查看詳情');
  });

  it('ticket drafting replaces the tabs with the chooser', () => {
    const offered = [...ticketById.keys()].slice(0, 3) as string[];
    const snap = baseSnap();
    snap.phase = Phase.TICKET_SELECTION;
    snap.you!.pendingOfferTicketIds = offered;
    render(<GameStage snapshot={snap} commands={null} onLeave={() => {}} />);
    expect(document.querySelector('.game-dock--chooser')).not.toBeNull();
    expect(dockTablist()).toBeNull();
  });

  it('keeps the turn countdown visible while drafting, inside the chooser', () => {
    const offered = [...ticketById.keys()].slice(0, 3) as string[];
    const snap = baseSnap();
    snap.phase = Phase.TICKET_SELECTION;
    snap.you!.pendingOfferTicketIds = offered;
    useGame.setState({ snapshot: snap, rejection: null, turnTimer: null });
    useGame.getState().applyTurnTimer('p0', 30_000, 75_000);
    render(<GameStage snapshot={snap} commands={null} onLeave={() => {}} />);
    // A mid-game keep is on the clock, and the chooser replaced the trackers block that normally
    // carries the countdown — so it moves INTO the chooser, and mounts exactly once.
    expect(document.querySelectorAll('[role="timer"]')).toHaveLength(1);
    expect(document.querySelector('.ticket-chooser [role="timer"]')).not.toBeNull();
    useGame.setState({ turnTimer: null });
  });

  it('the sandbox keeps the plain rail even at phone width', () => {
    render(<GameStage snapshot={baseSnap()} commands={null} onLeave={() => {}} sandbox />);
    expect(document.querySelector('.game--dock')).toBeNull();
    expect(document.querySelector('.game-rail')).not.toBeNull();
  });

  it('omits the Events tab when the game carries no random-events block', () => {
    render(<GameStage snapshot={baseSnap()} commands={null} onLeave={() => {}} />);
    expect(screen.queryByRole('tab', { name: '事件' })).toBeNull();
  });

  it('gives random events their own dock tab, separate from Players', () => {
    const snap = baseSnap({ mode: 'intense', roundIndex: 1, freeStationAvailable: true });
    // EventsPanel (like LogPanel) reads the contextual game store directly rather than the
    // `snapshot` prop threaded through GameStage, so the store needs the events block too.
    useGame.setState({ snapshot: snap, rejection: null });
    render(<GameStage snapshot={snap} commands={null} onLeave={() => {}} />);

    fireEvent.click(screen.getByRole('tab', { name: '事件' }));
    expect(document.querySelector('.dock-panel .events-panel')).not.toBeNull();
    expect(document.querySelector('.dock-panel .trackers')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: '玩家' }));
    expect(document.querySelector('.dock-panel .trackers')).not.toBeNull();
    expect(document.querySelector('.dock-panel .events-panel')).toBeNull();
  });
});
