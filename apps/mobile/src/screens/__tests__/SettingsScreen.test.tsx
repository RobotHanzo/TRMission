// The settings index (issue #47): its whole reason for existing is that a group's current value
// is legible WITHOUT drilling in, and that each row pushes its own page.
import { fireEvent, render, screen } from '@testing-library/react-native';
import '../../i18n';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { useSettings } from '../../store/settings';
import { useSession } from '../../store/session';
import { useUi } from '../../store/ui';
import { SettingsScreen } from '../SettingsScreen';

const nav = { navigate: jest.fn() };
const renderIndex = () => render(<SettingsScreen navigation={nav as never} route={{} as never} />);

describe('SettingsScreen index', () => {
  beforeEach(() => {
    nav.navigate.mockClear();
    useUi.setState({ theme: 'system', locale: 'zh-Hant', soundEnabled: true, soundVolume: 0.7 });
    useSettings.setState({ notifications: false, notifyOnlyWhenAway: true });
    useSession.setState({ user: { displayName: 'Ada', isGuest: false, email: 'a@b.c' } as never });
  });

  it('states each group current value on the row itself', () => {
    // The accessibility label is "title — value", which is also what a screen reader announces.
    renderIndex();
    expect(screen.getByLabelText('外觀 — 跟隨系統 · 中文')).toBeTruthy();
    expect(screen.getByLabelText('音效與震動 — 開啟 · 70%')).toBeTruthy();
    expect(screen.getByLabelText('推播通知 — 關閉')).toBeTruthy();
  });

  it('reflects a changed setting without a reload', () => {
    useUi.setState({ soundEnabled: false, theme: 'dark', locale: 'en' });
    useSettings.setState({ notifications: true, notifyOnlyWhenAway: true });
    renderIndex();
    expect(screen.getByLabelText('外觀 — 深色 · English')).toBeTruthy();
    expect(screen.getByLabelText('音效與震動 — 關閉')).toBeTruthy();
    expect(screen.getByLabelText('推播通知 — 僅離開時')).toBeTruthy();
  });

  it('each row pushes its own page', () => {
    renderIndex();
    fireEvent.press(screen.getByTestId('settings-nav-appearance'));
    expect(nav.navigate).toHaveBeenCalledWith('SettingsAppearance');
    fireEvent.press(screen.getByTestId('settings-nav-notifications'));
    expect(nav.navigate).toHaveBeenCalledWith('SettingsNotifications');
    fireEvent.press(screen.getByTestId('settings-nav-account'));
    expect(nav.navigate).toHaveBeenCalledWith('SettingsAccount');
  });

  it('names the account, and calls a guest a guest', () => {
    renderIndex();
    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getByText('a@b.c')).toBeTruthy();

    useSession.setState({ user: { displayName: '訪客', isGuest: true } as never });
    screen.rerender(<SettingsScreen navigation={nav as never} route={{} as never} />);
    expect(screen.getByText('訪客帳號')).toBeTruthy();
  });
});
