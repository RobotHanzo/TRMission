import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
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
    render(<OfflineHomeSection onNewGame={onNewGame} onResume={onResume} store={store} />);

    fireEvent.press(screen.getByTestId('offline-play-bots'));
    expect(onNewGame).toHaveBeenCalled();

    const entry = await waitFor(() => screen.getByTestId('offline-resume-local:home-1'));
    fireEvent.press(entry);
    expect(onResume).toHaveBeenCalledWith('local:home-1');
  });
});
