import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import '../i18n';
import { taiwanBoard } from '@trm/engine';
import { InMemoryLocalGameStore } from './inMemoryStore';
import { LocalGameSession } from './localGameSession';
import { newOfflineSetup } from './newGame';
import { OfflineHomeSection } from './OfflineHomeSection';

describe('OfflineHomeSection', () => {
  it('offers Play vs Bots and lists resumable games', async () => {
    const store = new InMemoryLocalGameStore();
    await LocalGameSession.create(
      newOfflineSetup({
        mapId: 'taiwan',
        botCount: 3,
        difficulty: 'HARD',
        eventsMode: 'off',
        gameId: 'local:home-1',
        seed: 's',
      }),
      taiwanBoard(),
      store,
    );

    const onNewGame = jest.fn();
    const onResume = jest.fn();
    await render(<OfflineHomeSection onNewGame={onNewGame} onResume={onResume} store={store} />);

    await fireEvent.press(screen.getByTestId('offline-play-bots'));
    expect(onNewGame).toHaveBeenCalled();

    const entry = await waitFor(() => screen.getByTestId('offline-resume-local:home-1'));
    await fireEvent.press(entry);
    expect(onResume).toHaveBeenCalledWith('local:home-1');
  });

  it('deletes a saved game only after the confirmation is accepted', async () => {
    const store = new InMemoryLocalGameStore();
    await LocalGameSession.create(
      newOfflineSetup({
        mapId: 'taiwan',
        botCount: 2,
        difficulty: 'EASY',
        eventsMode: 'off',
        gameId: 'local:home-2',
        seed: 's',
      }),
      taiwanBoard(),
      store,
    );

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      await render(<OfflineHomeSection onNewGame={jest.fn()} onResume={jest.fn()} store={store} />);

      await waitFor(() => screen.getByTestId('offline-resume-local:home-2'));
      await fireEvent.press(screen.getByTestId('offline-delete-local:home-2'));

      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(await store.loadGame('local:home-2')).not.toBeNull();

      // The confirm button fires an async delete → reload → setState chain. Drive it inside
      // await act() so the re-render is FLUSHED rather than polled for — waitFor's 1s budget is a
      // coin flip on a loaded CI runner.
      const buttons = alertSpy.mock.calls[0][2] as AlertButton[];
      await act(async () => {
        buttons.find((b) => b.style === 'destructive')!.onPress!();
      });

      expect(screen.queryByTestId('offline-resume-local:home-2')).toBeNull();
      expect(await store.loadGame('local:home-2')).toBeNull();
    } finally {
      alertSpy.mockRestore();
    }
  });
});
