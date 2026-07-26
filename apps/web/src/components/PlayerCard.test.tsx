import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema } from '@trm/proto';
import '../i18n'; // initialise react-i18next so labels resolve
import i18n from '../i18n';
import { PlayerCard } from './PlayerCard';
import { PlayerTrackers } from './PlayerTrackers';
import { useAnimations } from '../store/animations';
import { useRoster } from '../store/roster';
import { TICKETS, ROUTES, ticketById } from '../game/content';

const doneTicket = TICKETS[0]!.id as string;
const gain = ticketById.get(doneTicket)!.value;
const mine = [ROUTES[0]!.id as string, ROUTES[1]!.id as string];
const theirs = ROUTES[2]!.id as string;

const snap = create(GameSnapshotSchema, {
  stateVersion: 1,
  currentPlayerId: 'p1',
  players: [
    {
      id: 'p0',
      seat: 0,
      team: -1,
      trainCars: 4,
      routePoints: 30,
      handCount: 6,
      ticketCount: 2,
      stationsRemaining: 1,
      bentoTokens: 2,
    },
    { id: 'p1', seat: 1, team: -1, trainCars: 40, routePoints: 10, stationsRemaining: 3 },
  ],
  you: { playerId: 'p1' },
  completedTickets: [{ playerId: 'p0', ticketId: doneTicket }],
  stations: [{ playerId: 'p0', cityId: 'taichung' }],
  ownership: [
    { routeId: mine[0]!, cell: { case: 'ownerPlayerId', value: 'p0' } },
    { routeId: mine[1]!, cell: { case: 'ownerPlayerId', value: 'p0' } },
    { routeId: theirs, cell: { case: 'ownerPlayerId', value: 'p1' } },
  ],
});

describe('PlayerCard (issue #14)', () => {
  beforeEach(() => {
    useAnimations.getState().reset();
    useRoster.getState().clear();
    void i18n.changeLanguage('zh-Hant');
  });

  it('shows the live score split into route points and completed-mission value', () => {
    const { container } = render(<PlayerCard snapshot={snap} playerId="p0" onClose={() => {}} />);
    expect(container.querySelector('.pcard-total b')!.textContent).toBe(String(30 + gain));
    const ledger = [...container.querySelectorAll('.pcard-ledger dd')].map((n) => n.textContent);
    expect(ledger).toEqual(['30', `+${gain}`]);
  });

  it('warns that the endgame is close when the train supply runs low', () => {
    render(<PlayerCard snapshot={snap} playerId="p0" onClose={() => {}} />);
    expect(screen.getByText('即將觸發終局')).toBeInTheDocument();
  });

  it('lights only that player’s own routes on the board, and clears them again', () => {
    render(<PlayerCard snapshot={snap} playerId="p0" onClose={() => {}} />);
    fireEvent.click(screen.getByText('在地圖上顯示路網'));
    expect(useAnimations.getState().routeReveal).toEqual({ seat: 0, path: mine });

    fireEvent.click(screen.getByText('隱藏路網'));
    expect(useAnimations.getState().routeReveal).toBeNull();
  });

  it('drops the highlight when the card closes, so the board cannot keep glowing', () => {
    const { unmount } = render(<PlayerCard snapshot={snap} playerId="p0" onClose={() => {}} />);
    fireEvent.click(screen.getByText('在地圖上顯示路網'));
    expect(useAnimations.getState().routeReveal).not.toBeNull();
    unmount();
    expect(useAnimations.getState().routeReveal).toBeNull();
  });

  it('offers no map reveal for a player who has claimed nothing', () => {
    const empty = create(GameSnapshotSchema, {
      players: [{ id: 'p0', seat: 0, team: -1, trainCars: 45 }],
    });
    render(<PlayerCard snapshot={empty} playerId="p0" onClose={() => {}} />);
    expect(screen.getByText('在地圖上顯示路網').closest('button')).toBeDisabled();
    expect(screen.getByText('尚未完成任務')).toBeInTheDocument();
  });

  it('renders nothing for an id that is not seated', () => {
    const { container } = render(
      <PlayerCard snapshot={snap} playerId="ghost" onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('Esc closes the card', () => {
    let closed = false;
    render(<PlayerCard snapshot={snap} playerId="p0" onClose={() => (closed = true)} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closed).toBe(true);
  });
});

describe('PlayerTrackers rows (issue #14)', () => {
  beforeEach(() => {
    useAnimations.getState().reset();
    useRoster.getState().clear();
    void i18n.changeLanguage('zh-Hant');
  });

  it('keeps only the score and train cars in the row — the rest moved to the card', () => {
    const { container } = render(<PlayerTrackers snapshot={snap} />);
    const row = container.querySelector('[data-player-id="p0"]')!;
    expect(row.querySelector('.tracker-score')!.textContent).toBe(String(30 + gain));
    expect(row.querySelector('.tracker-cars')!.textContent).toContain('4');
    // Hand / mission / station counts are no longer crammed into the row.
    expect(row.textContent).not.toContain('6');
  });

  it('flags a low train supply on the row as well as the gauge', () => {
    const { container } = render(<PlayerTrackers snapshot={snap} />);
    expect(container.querySelector('[data-player-id="p0"]')!.className).toContain('low');
    expect(container.querySelector('[data-player-id="p1"]')!.className).not.toContain('low');
  });

  it('opens the card for the row that was clicked', () => {
    const seen: string[] = [];
    render(<PlayerTrackers snapshot={snap} onInspect={(id) => seen.push(id)} />);
    fireEvent.click(screen.getByLabelText('查看 P1 的詳情'));
    expect(seen).toEqual(['p0']);
  });

  it('renders rows as plain markup when no inspect handler is passed', () => {
    const { container } = render(<PlayerTrackers snapshot={snap} />);
    expect(container.querySelector('button.tracker')).toBeNull();
  });
});
