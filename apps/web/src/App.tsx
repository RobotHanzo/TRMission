import { useUi } from './store/ui';
import { AppHeader } from './components/AppHeader';
import { HomeScreen } from './screens/HomeScreen';
import { RoomScreen } from './screens/RoomScreen';
import { GameScreen } from './screens/GameScreen';
import './styles/app.css';

export function App() {
  const view = useUi((s) => s.view);
  return (
    <div className="app">
      <AppHeader />
      <main className="app-main">
        {view === 'home' && <HomeScreen />}
        {view === 'room' && <RoomScreen />}
        {view === 'game' && <GameScreen />}
      </main>
    </div>
  );
}
