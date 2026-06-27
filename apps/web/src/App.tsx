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
  const { t, i18n } = useTranslation();
  const view = useUi((s) => s.view);
  const theme = useUi((s) => s.theme);
  const locale = useUi((s) => s.locale);
  const booting = useSession((s) => s.booting);
  const restore = useSession((s) => s.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

  // Apply the chosen locale to i18next + <html lang> (covers the localStorage-seeded initial value).
  useEffect(() => {
    void i18n.changeLanguage(locale);
    document.documentElement.lang = locale;
  }, [i18n, locale]);

  // Resolve the theme ('system' follows the OS) and stamp it on <html> for the CSS tokens.
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      root.setAttribute('data-theme', dark ? 'dark' : 'light');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  return (
    <div className="app">
      <AppHeader />
      <main className={view === 'game' ? 'app-main app-main--game' : 'app-main'}>
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
