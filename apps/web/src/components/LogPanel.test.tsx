import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase } from '@trm/proto';
import '../i18n';
import { LogPanel } from './LogPanel';
import { useLog } from '../store/log';
import { useGame } from '../store/game';
import { TICKETS } from '../game/content';
import type { LogEntry } from '../game/logModel';

const makeEntry = (id: number): LogEntry => ({
  id,
  kind: 'gameStarted',
  playerId: null,
  data: {},
  importance: 'normal',
});

const setLogEntries = (ids: number[]): void => {
  useLog.setState({
    entries: ids.map(makeEntry),
    nextId: (ids.at(-1) ?? 0) + 1,
  });
};

const mockScrollableList = (
  element: HTMLElement,
  initialScrollHeight = 300,
  clientHeight = 100,
) => {
  let scrollHeight = initialScrollHeight;
  let scrollTop = Math.max(0, scrollHeight - clientHeight);
  const maxScrollTop = (): number => Math.max(0, scrollHeight - clientHeight);

  Object.defineProperties(element, {
    clientHeight: { configurable: true, get: () => clientHeight },
    scrollHeight: { configurable: true, get: () => scrollHeight },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.min(Math.max(0, value), maxScrollTop());
      },
    },
  });

  return {
    setScrollTop(value: number): void {
      scrollTop = Math.min(Math.max(0, value), maxScrollTop());
    },
    setScrollHeight(value: number): void {
      scrollHeight = value;
      scrollTop = Math.min(scrollTop, maxScrollTop());
    },
  };
};

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

  it('pauses auto-scroll after manual scrolling and resumes when scrolled back to the bottom', () => {
    setLogEntries([1]);
    render(<LogPanel />);
    const list = document.querySelector('.log-list') as HTMLElement;
    const scroll = mockScrollableList(list);

    scroll.setScrollTop(80);
    fireEvent.scroll(list);
    expect(screen.getByRole('button', { name: '捲動至最新動作' })).toBeInTheDocument();

    scroll.setScrollHeight(320);
    act(() => setLogEntries([1, 2]));
    expect(list.scrollTop).toBe(80);

    scroll.setScrollTop(220);
    fireEvent.scroll(list);
    expect(screen.queryByRole('button', { name: '捲動至最新動作' })).not.toBeInTheDocument();

    scroll.setScrollHeight(340);
    act(() => setLogEntries([1, 2, 3]));
    expect(list.scrollTop).toBe(240);
  });

  it('jumps to the bottom from the floating button and restores auto-follow', () => {
    setLogEntries([1]);
    render(<LogPanel />);
    const list = document.querySelector('.log-list') as HTMLElement;
    const scroll = mockScrollableList(list);

    scroll.setScrollTop(50);
    fireEvent.scroll(list);
    fireEvent.click(screen.getByRole('button', { name: '捲動至最新動作' }));

    expect(list.scrollTop).toBe(200);
    expect(screen.queryByRole('button', { name: '捲動至最新動作' })).not.toBeInTheDocument();

    scroll.setScrollHeight(320);
    act(() => setLogEntries([1, 2]));
    expect(list.scrollTop).toBe(220);
  });

  it('keeps following when the newest entry changes without changing the list length', () => {
    setLogEntries([1]);
    render(<LogPanel />);
    const list = document.querySelector('.log-list') as HTMLElement;
    const scroll = mockScrollableList(list);

    scroll.setScrollHeight(320);
    act(() => setLogEntries([2]));

    expect(list.scrollTop).toBe(220);
  });

  it('resumes following when a shorter replacement clamps the viewport to the bottom', () => {
    setLogEntries([1, 2]);
    render(<LogPanel />);
    const list = document.querySelector('.log-list') as HTMLElement;
    const scroll = mockScrollableList(list, 500);

    scroll.setScrollTop(300);
    fireEvent.scroll(list);
    expect(screen.getByRole('button', { name: '捲動至最新動作' })).toBeInTheDocument();

    scroll.setScrollHeight(250);
    act(() => setLogEntries([3]));
    expect(screen.queryByRole('button', { name: '捲動至最新動作' })).not.toBeInTheDocument();

    scroll.setScrollHeight(270);
    act(() => setLogEntries([3, 4]));
    expect(list.scrollTop).toBe(170);
  });
});
