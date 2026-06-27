import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUi } from './store/ui';
import { useSession } from './store/session';
import { AppHeader } from './components/AppHeader';
import { HomeScreen } from './screens/HomeScreen';
import { RoomScreen } from './screens/RoomScreen';
import { GameScreen } from './screens/GameScreen';
import './styles/app.css';

export function App() {
  const { t } = useTranslation();
  const view = useUi((s) => s.view);
  const booting = useSession((s) => s.booting);
  const restore = useSession((s) => s.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

  return (
    <div className="app">
      <AppHeader />
      <main className="app-main">
        {booting ? (
          <div className="card">{t('connecting')}</div>
        ) : (
          <>
            {view === 'home' && <HomeScreen />}
            {view === 'room' && <RoomScreen />}
            {view === 'game' && <GameScreen />}
          </>
        )}
      </main>
    </div>
  );
}
