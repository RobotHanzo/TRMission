import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase } from '@trm/proto';
import '../i18n'; // initialise react-i18next so labels resolve
import i18n from '../i18n';
import { ScoreBoard } from './ScoreBoard';
import { useAnimations } from '../store/animations';
import { TICKETS, ROUTES, ticketById } from '../game/content';

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
    // Gains (+) and losses (−) are broken out (p0 is first by total), plus longest + total.
    expect(container.querySelector('td.gain')!.textContent).toContain(`+${gain}`);
    expect(container.querySelector('td.loss')!.textContent).toContain(`−${loss}`);
    expect(screen.getByText('18 節車廂（+11 分）')).toBeInTheDocument();
    expect(screen.getByText('137')).toBeInTheDocument();
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
});
