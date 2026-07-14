import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase } from '@trm/proto';
import '../i18n'; // initialise react-i18next so labels resolve
import i18n from '../i18n';
import { ScoreBoard } from './ScoreBoard';
import { useAnimations } from '../store/animations';
import { TICKETS, ROUTES, ticketById } from '../game/content';
import type { RoomMember } from '../net/rest';
import { useUi } from '../store/ui';
import { api } from '../net/rest';

const done = TICKETS[0]!.id as string;
const failed = TICKETS[1]!.id as string;
const gain = ticketById.get(done)!.value;
const loss = ticketById.get(failed)!.value;
const longestRoutes = [ROUTES[0]!.id as string, ROUTES[1]!.id as string];

const snap = create(GameSnapshotSchema, {
  stateVersion: 1,
  phase: Phase.GAME_OVER,
  players: [
    { id: 'p0', seat: 0, routePoints: 50 },
    { id: 'bot:1', seat: 1, routePoints: 20 },
  ],
  you: { playerId: 'p0' },
  finalScores: {
    players: [
      {
        playerId: 'p0',
        routePoints: 50,
        ticketNet: gain - loss,
        ticketsCompleted: 1,
        stationsUsed: 1,
        unusedStations: 2,
        stationBonus: 8,
        longestTrailLength: 18,
        longestBonus: 11,
        eventBonus: 4,
        total: 137,
        keptTicketIds: [done, failed],
        completedTicketIds: [done],
        longestTrailRouteIds: longestRoutes,
      },
      {
        playerId: 'bot:1',
        routePoints: 20,
        ticketNet: 0,
        ticketsCompleted: 0,
        stationsUsed: 0,
        unusedStations: 3,
        stationBonus: 12,
        longestTrailLength: 0,
        longestBonus: 0,
        total: 32,
        keptTicketIds: [],
        completedTicketIds: [],
        longestTrailRouteIds: [],
      },
    ],
    ranking: [{ playerIds: ['p0'] }, { playerIds: ['bot:1'] }],
  },
});

// Assert against the app's primary locale (zh-Hant); restore it each test so the shared i18n
// singleton is never left in a non-default state for other component tests.
describe('ScoreBoard', () => {
  beforeEach(() => {
    useAnimations.getState().reset();
    void i18n.changeLanguage('zh-Hant');
  });

  it('shows every scoring category with gains and losses, not just three methods', () => {
    const { container } = render(<ScoreBoard snapshot={snap} onLeave={() => {}} />);
    // Named category headers (not just emoji) — completed vs failed are distinct columns.
    expect(screen.getByText(/路線分數/)).toBeInTheDocument();
    expect(screen.getByText(/✅ 完成任務/)).toBeInTheDocument();
    expect(screen.getByText(/未完成任務/)).toBeInTheDocument();
    expect(screen.getByText(/車站獎勵/)).toBeInTheDocument();
    expect(screen.getByText(/最長路線/)).toBeInTheDocument();
    expect(screen.getByText(/事件獎勵/)).toBeInTheDocument();
    // Gains (+) and losses (−) are broken out (p0 is first by total), plus longest + total.
    expect(container.querySelector('td.gain')!.textContent).toContain(`+${gain}`);
    expect(container.querySelector('td.loss')!.textContent).toContain(`−${loss}`);
    expect(screen.getByText('18 節車廂（+11 分）')).toBeInTheDocument();
    expect(screen.getByText('+4')).toBeInTheDocument();
    expect(screen.getByText('137')).toBeInTheDocument();
  });

  // ≤820px the table stacks into per-player cards and the header row is hidden, so each score cell
  // carries its own column label (data-label) — an unlabelled cell would render as a bare number.
  it('labels every score cell with its column header for the stacked (narrow) layout', () => {
    const { container } = render(<ScoreBoard snapshot={snap} onLeave={() => {}} />);
    const headers = [...container.querySelectorAll('thead th')]
      .slice(1) // the player column heads the card, so it needs no per-cell label
      .map((th) => th.getAttribute('title') ?? th.textContent!.trim());
    const firstRowLabels = [...container.querySelectorAll('tbody tr:first-child td.num')].map(
      (td) => td.getAttribute('data-label'),
    );
    expect(firstRowLabels).toEqual(headers);
  });

  it('hides the event-bonus column entirely for a game played without random events', () => {
    const offSnap = create(GameSnapshotSchema, {
      stateVersion: 1,
      phase: Phase.GAME_OVER,
      players: [{ id: 'p0', seat: 0, routePoints: 50 }],
      you: { playerId: 'p0' },
      finalScores: {
        players: [
          {
            playerId: 'p0',
            routePoints: 50,
            total: 50,
            keptTicketIds: [],
            completedTicketIds: [],
            longestTrailRouteIds: [],
          },
        ],
        ranking: [{ playerIds: ['p0'] }],
      },
    });
    render(<ScoreBoard snapshot={offSnap} onLeave={() => {}} />);
    expect(screen.queryByText(/事件獎勵/)).not.toBeInTheDocument();
  });

  it('opens a ticket-card list for the completed (gains) tickets', () => {
    render(<ScoreBoard snapshot={snap} onLeave={() => {}} />);
    // Two "查看" (view) buttons exist (completed + failed for p0); the first is the gains list.
    fireEvent.click(screen.getAllByLabelText('查看')[0]!);
    // A second dialog (the ticket list) opens with the completed ticket card.
    expect(screen.getAllByRole('dialog').length).toBe(2);
    expect(screen.getByRole('img', { name: /已完成/ })).toBeInTheDocument();
  });

  it('reveals the longest route on the map and switches to the review bar', () => {
    render(<ScoreBoard snapshot={snap} onLeave={() => {}} />);
    fireEvent.click(screen.getByLabelText('在地圖上查看'));
    expect(useAnimations.getState().routeReveal).toEqual({ seat: 0, path: longestRoutes });
    expect(screen.getByText('返回計分板')).toBeInTheDocument();
  });

  it('dismisses the scoreboard to inspect the map, then returns to it', () => {
    render(<ScoreBoard snapshot={snap} onLeave={() => {}} />);
    fireEvent.click(screen.getByText('查看地圖'));
    // The scoreboard dialog is gone; only the floating inspect bar remains.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('正在查看地圖')).toBeInTheDocument();
    fireEvent.click(screen.getByText('返回計分板'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('leaves directly from the inspect-map bar without reopening the scoreboard', () => {
    const onLeave = vi.fn();
    render(<ScoreBoard snapshot={snap} onLeave={onLeave} />);
    fireEvent.click(screen.getByText('查看地圖'));
    fireEvent.click(screen.getByText('離開遊戲'));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});

const member = (over: Partial<RoomMember> = {}): RoomMember => ({
  userId: 'p0',
  displayName: 'Host',
  isGuest: false,
  seat: 0,
  ready: false,
  ...over,
});

describe('ScoreBoard rematch', () => {
  beforeEach(() => {
    useAnimations.getState().reset();
    void i18n.changeLanguage('zh-Hant');
  });

  it('lets a viewer toggle their rematch vote', () => {
    const onVote = vi.fn();
    const members = [
      member({ userId: 'p0' }),
      member({ userId: 'bot:1', isBot: true, ready: true }),
    ];
    render(<ScoreBoard snapshot={snap} onLeave={() => {}} members={members} onVote={onVote} />);
    fireEvent.click(screen.getByRole('button', { name: /想再玩一局/ }));
    expect(onVote).toHaveBeenCalledWith(true);
  });

  it('shows the tally excluding bots', () => {
    const members = [
      member({ userId: 'p0', wantsRematch: true }),
      member({ userId: 'bot:1', isBot: true, ready: true }),
    ];
    render(<ScoreBoard snapshot={snap} onLeave={() => {}} members={members} onVote={() => {}} />);
    expect(screen.getByText('1/1 人想再玩一局')).toBeInTheDocument();
  });

  it('only shows Play Again to the host', () => {
    const members = [member({ userId: 'p0' })];
    const onPlayAgain = vi.fn();
    const { rerender } = render(
      <ScoreBoard
        snapshot={snap}
        onLeave={() => {}}
        members={members}
        onVote={() => {}}
        onPlayAgain={onPlayAgain}
        isHost={false}
      />,
    );
    expect(screen.queryByRole('button', { name: '再玩一局' })).not.toBeInTheDocument();

    rerender(
      <ScoreBoard
        snapshot={snap}
        onLeave={() => {}}
        members={members}
        onVote={() => {}}
        onPlayAgain={onPlayAgain}
        isHost={true}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '再玩一局' }));
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
  });

  it('renders no rematch controls when members/callbacks are not provided (sandbox/replay)', () => {
    render(<ScoreBoard snapshot={snap} onLeave={() => {}} />);
    expect(screen.queryByRole('button', { name: /想再玩一局/ })).not.toBeInTheDocument();
  });
});

describe('ScoreBoard rating + Discord', () => {
  beforeEach(() => {
    useAnimations.getState().reset();
    void i18n.changeLanguage('zh-Hant');
    localStorage.clear();
    useUi.setState({ gameId: 'g1', roomCode: 'ABCDE' });
  });

  it('disables submit until a star is picked, then submits and shows thanks', async () => {
    const submitRating = vi
      .spyOn(api, 'submitRating')
      .mockResolvedValue({ id: 'r1', stars: 4, createdAt: '2026-01-01T00:00:00.000Z' });
    render(<ScoreBoard snapshot={snap} onLeave={() => {}} />);

    const submit = screen.getByRole('button', { name: '送出評分' });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getAllByRole('radio')[3]!);
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);
    await screen.findByText('感謝你的評分！');
    expect(submitRating).toHaveBeenCalledWith({ gameId: 'g1', roomId: 'ABCDE', stars: 4 });
  });

  it('remembers a rated game across remounts via localStorage', () => {
    localStorage.setItem('trm.ratedGameIds', JSON.stringify(['g1']));
    render(<ScoreBoard snapshot={snap} onLeave={() => {}} />);
    expect(screen.getByText('感謝你的評分！')).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('always shows a Discord join button', () => {
    render(<ScoreBoard snapshot={snap} onLeave={() => {}} />);
    expect(screen.getByRole('button', { name: /加入 Discord 社群/ })).toBeInTheDocument();
  });
});
