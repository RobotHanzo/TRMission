import { useEffect } from 'react';
import {
  Activity,
  ClipboardList,
  DoorOpen,
  Languages,
  LogOut,
  Map as MapIcon,
  Moon,
  ShieldCheck,
  Star,
  Sun,
  Swords,
  ToggleRight,
  Trash2,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DashboardPermission } from '@trm/shared';
import { useSession } from './store/session';
import { useUi, type AdminView } from './store/ui';
import { DeniedView } from './views/DeniedView';
import { OverviewView } from './views/OverviewView';
import { UsersView } from './views/UsersView';
import { FeaturesView } from './views/FeaturesView';
import { GamesView } from './views/GamesView';
import { RoomsView } from './views/RoomsView';
import { MapsView } from './views/MapsView';
import { RatingsView } from './views/RatingsView';
import { MaintainersView } from './views/MaintainersView';
import { AuditView } from './views/AuditView';
import { PurgeView } from './views/PurgeView';
import { ToastStack } from './components/ToastStack';

const NAV: { view: AdminView; permission: DashboardPermission; icon: typeof Users }[] = [
  { view: 'overview', permission: 'overview.read', icon: Activity },
  { view: 'users', permission: 'users.read', icon: Users },
  { view: 'features', permission: 'users.features', icon: ToggleRight },
  { view: 'games', permission: 'games.read', icon: Swords },
  { view: 'rooms', permission: 'rooms.read', icon: DoorOpen },
  { view: 'maps', permission: 'maps.read', icon: MapIcon },
  { view: 'ratings', permission: 'ratings.read', icon: Star },
  { view: 'maintainers', permission: 'maintainers.read', icon: ShieldCheck },
  { view: 'audit', permission: 'audit.read', icon: ClipboardList },
  { view: 'purge', permission: 'purge.read', icon: Trash2 },
];

const ROLE_KEY = {
  owner: 'maintainers.roleOwner',
  admin: 'maintainers.roleAdmin',
  moderator: 'maintainers.roleModerator',
  viewer: 'maintainers.roleViewer',
} as const;

function ActiveView({ view }: { view: AdminView }) {
  switch (view) {
    case 'users':
      return <UsersView />;
    case 'features':
      return <FeaturesView />;
    case 'games':
      return <GamesView />;
    case 'rooms':
      return <RoomsView />;
    case 'maps':
      return <MapsView />;
    case 'ratings':
      return <RatingsView />;
    case 'maintainers':
      return <MaintainersView />;
    case 'audit':
      return <AuditView />;
    case 'purge':
      return <PurgeView />;
    default:
      return <OverviewView />;
  }
}

export default function App() {
  const { t } = useTranslation();
  const session = useSession();
  const ui = useUi();

  useEffect(() => {
    void useSession.getState().restore();
    const onPop = () => useUi.getState().syncFromUrl();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (session.phase === 'booting' || session.phase === 'unauthenticated') {
    return <div className="oc-gate oc-muted">{t('common.loading')}</div>;
  }
  if (session.phase === 'denied') return <DeniedView />;

  const visibleNav = NAV.filter((n) => session.permissions.has(n.permission));
  const view = ui.view;

  return (
    <div className="oc-shell">
      <nav className="oc-rail" aria-label="main">
        <div className="oc-brand">
          <img
            className="oc-brand-icon"
            src={`${import.meta.env.BASE_URL}icon.svg`}
            width={20}
            height={20}
            alt=""
          />
          <div className="text">
            <span className="name">{t('brand.name')}</span>
            <span className="sub">{t('brand.sub')}</span>
          </div>
        </div>
        {visibleNav.map(({ view: v, icon: Icon }) => (
          <button
            key={v}
            className={`oc-nav-item ${view === v ? 'active' : ''}`}
            onClick={() => ui.navigate(v)}
            aria-current={view === v ? 'page' : undefined}
          >
            <Icon size={16} aria-hidden />
            <span>{t(`nav.${v}`)}</span>
          </button>
        ))}
        <div className="oc-rail-foot">
          <button className="oc-nav-item" onClick={() => void session.logout()}>
            <LogOut size={16} aria-hidden />
            <span>{t('nav.logout')}</span>
          </button>
        </div>
      </nav>

      <header className="oc-strip">
        <span className="oc-eyebrow">{t(`nav.${view}`)}</span>
        <span className="spacer" />
        {session.user && (
          <span className="oc-chip">
            {session.user.displayName}
            {session.role && <span className="oc-role-badge">{t(ROLE_KEY[session.role])}</span>}
          </span>
        )}
        <button
          className="oc-icon-btn"
          onClick={() => ui.setLocale(ui.locale === 'zh-Hant' ? 'en' : 'zh-Hant')}
          aria-label={t('nav.language')}
          title={t('nav.language')}
        >
          <Languages size={16} aria-hidden />
        </button>
        <button
          className="oc-icon-btn"
          onClick={() => ui.toggleTheme()}
          aria-label={t('nav.theme')}
          title={t('nav.theme')}
        >
          {ui.theme === 'dark' ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
        </button>
      </header>

      <main className="oc-main">
        <ActiveView view={view} />
      </main>
      <ToastStack />
    </div>
  );
}
