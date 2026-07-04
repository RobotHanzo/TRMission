import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase } from '@trm/proto';
import '../i18n';
import { AppHeader } from './AppHeader';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { useGame } from '../store/game';

const signedIn = {
  id: 'u1',
  displayName: 'Tester',
  isGuest: false,
  preferences: { theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' },
  features: [] as import('@trm/shared').UserFeature[],
} as const;

const gameSnap = () =>
  create(GameSnapshotSchema, {
    stateVersion: 1,
    phase: Phase.AWAIT_ACTION,
    currentPlayerId: 'p0',
    turnOrder: ['p0', 'p1'],
    players: [
      { id: 'p0', seat: 0, trainCars: 45, stationsRemaining: 3 },
      { id: 'p1', seat: 1, trainCars: 45, stationsRemaining: 3 },
    ],
  });

describe('AppHeader brand + leave confirmation (desktop)', () => {
  afterEach(() => {
    useUi.setState({ view: 'home' });
    useGame.setState({ snapshot: null });
    useSession.setState({ user: null });
  });

  it('brand click navigates home immediately when there is no active room/game', () => {
    useSession.setState({ user: { ...signedIn } });
    useUi.setState({ view: 'history' });
    render(<AppHeader />);
    fireEvent.click(screen.getByRole('button', { name: /台鐵任務/ }));
    expect(useUi.getState().view).toBe('home');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('brand click asks for confirmation while in the lobby', () => {
    useSession.setState({ user: { ...signedIn } });
    useUi.setState({ view: 'room', roomCode: 'ABCD' });
    render(<AppHeader />);
    fireEvent.click(screen.getByRole('button', { name: /台鐵任務/ }));
    expect(useUi.getState().view).toBe('room');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    expect(useUi.getState().view).toBe('home');
  });

  it('brand click asks for confirmation during an active game; cancel leaves it untouched', () => {
    useSession.setState({ user: { ...signedIn } });
    useUi.setState({ view: 'game' });
    useGame.setState({ snapshot: gameSnap() });
    render(<AppHeader />);
    fireEvent.click(screen.getByRole('button', { name: /台鐵任務/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useUi.getState().view).toBe('game');
  });

  it('the desktop leave button also confirms before leaving', () => {
    useSession.setState({ user: { ...signedIn } });
    useUi.setState({ view: 'game' });
    useGame.setState({ snapshot: gameSnap() });
    render(<AppHeader />);
    fireEvent.click(screen.getByRole('button', { name: '離開房間' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    expect(useUi.getState().view).toBe('home');
  });
});
