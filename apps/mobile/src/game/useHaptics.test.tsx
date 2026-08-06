import { render, act } from '@testing-library/react-native';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, type GameEvent, type GameSnapshot } from '@trm/proto';
import * as Haptics from 'expo-haptics';
import { useGame } from '../store/game';
import { useSettings } from '../store/settings';
import { useHaptics } from './useHaptics';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Medium: 'medium', Heavy: 'heavy', Rigid: 'rigid' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));

const snap = (): GameSnapshot =>
  create(GameSnapshotSchema, {
    stateVersion: 1,
    players: [
      { id: 'p0', seat: 0 },
      { id: 'p1', seat: 1 },
    ],
    you: { playerId: 'p0' },
  });

const turnOf = (playerId: string): GameEvent =>
  ({ event: { case: 'turnStarted', value: { playerId } } }) as GameEvent;

function Harness({ playing }: { playing: boolean }) {
  useHaptics(playing);
  return null;
}

/** Mount, deliver one batch, and report every impact style fired. */
function fire(playing: boolean, events: GameEvent[]): string[] {
  render(<Harness playing={playing} />);
  act(() => useGame.getState().applySnapshot(snap()));
  act(() => useGame.getState().applyEvents(2, events));
  return (Haptics.impactAsync as jest.Mock).mock.calls.map(([style]) => style as string);
}

describe('useHaptics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useGame.getState().reset();
    useSettings.getState().setHaptics(true);
  });

  it('double-pulses when the viewer’s own turn starts', async () => {
    expect(fire(true, [turnOf('p0')])).toEqual(['rigid']);
    // The second pulse lands after the gap; awaiting a macrotask is enough with real timers.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect((Haptics.impactAsync as jest.Mock).mock.calls).toHaveLength(2);
  });

  it('stays silent for an opponent’s turn', () => {
    expect(fire(true, [turnOf('p1')])).toEqual([]);
  });

  it('stays silent when the viewer is only watching (replay / demo clip)', () => {
    expect(fire(false, [turnOf('p0')])).toEqual([]);
  });

  it('stays silent when the device haptics switch is off', () => {
    useSettings.getState().setHaptics(false);
    expect(fire(true, [turnOf('p0')])).toEqual([]);
  });
});
