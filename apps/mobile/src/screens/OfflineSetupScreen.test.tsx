import { render, screen, fireEvent, act } from '@testing-library/react-native';
import '../i18n';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { useSession } from '../store/session';
import { OfflineSetupScreen } from './OfflineSetupScreen';

// The session store (useHasFeature) drags in secureStore + push/register → native modules.
jest.mock('../net/rest', () => ({
  api: {},
  setOnTokenChange: jest.fn(),
  setAccessToken: jest.fn(),
}));
jest.mock('../net/secureStore', () => ({
  readRefreshToken: jest.fn(),
  getRefreshToken: jest.fn(),
  setRefreshToken: jest.fn(),
  clearRefreshToken: jest.fn(),
}));
jest.mock('../push/register', () => ({
  registerDeviceForPush: jest.fn(),
  unregisterDeviceForPush: jest.fn(),
}));

type Props = NativeStackScreenProps<RootStackParamList, 'OfflineSetup'>;

const baseUser = {
  id: 'u1',
  displayName: 'Tester',
  isGuest: false,
  preferences: { theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' },
  tutorialCompleted: true,
} as const;

function renderScreen(replace: jest.Mock) {
  const navigation = { replace } as unknown as Props['navigation'];
  const route = { key: 'OfflineSetup', name: 'OfflineSetup' } as unknown as Props['route'];
  render(<OfflineSetupScreen navigation={navigation} route={route} />);
}

describe('OfflineSetupScreen', () => {
  afterEach(() => {
    act(() => {
      useSession.setState({ user: null });
    });
  });

  it('hides the events picker and starts eventsMode off without the randomEvents feature', () => {
    useSession.setState({ user: { ...baseUser, features: [] }, booting: false });
    const replace = jest.fn();
    renderScreen(replace);

    expect(screen.queryByText('隨機事件')).toBeNull();
    fireEvent.press(screen.getByText('開始對局'));
    expect(replace).toHaveBeenCalledWith(
      'OfflineGame',
      expect.objectContaining({ eventsMode: 'off' }),
    );
  });

  // Regression (#41): the picker used to offer only the layouts the CURRENT bot count could form,
  // so the default 2-bot table showed a lone "free-for-all" chip and read as "offline games can't
  // do teams". Every mode is offered; picking one moves the bot count to a table that fits.
  it('offers every team mode and snaps the bot count to a table that can form it', () => {
    useSession.setState({ user: { ...baseUser, features: [] }, booting: false });
    const replace = jest.fn();
    renderScreen(replace);

    expect(screen.getByText('兩隊')).toBeTruthy();
    expect(screen.getByText('三隊')).toBeTruthy();

    fireEvent.press(screen.getByText('三隊'));
    expect(screen.getByText('6 人・2 人一隊')).toBeTruthy(); // three pairs
    fireEvent.press(screen.getByText('開始對局'));
    expect(replace).toHaveBeenCalledWith(
      'OfflineGame',
      expect.objectContaining({ teamCount: 3, botCount: 5 }),
    );
  });

  it('drops back to free-for-all when the bot count can no longer form the chosen layout', () => {
    useSession.setState({ user: { ...baseUser, features: [] }, booting: false });
    const replace = jest.fn();
    renderScreen(replace);

    fireEvent.press(screen.getByText('兩隊'));
    fireEvent.press(screen.getByText('4')); // 5 players — no layout divides it
    fireEvent.press(screen.getByText('開始對局'));
    const params = replace.mock.calls[0]![1] as Record<string, unknown>;
    expect(params).toMatchObject({ botCount: 4 });
    expect(params.teamCount).toBeUndefined();
  });

  it('lets a randomEvents holder pick an intensity and threads it into the new game', () => {
    useSession.setState({ user: { ...baseUser, features: ['randomEvents'] }, booting: false });
    const replace = jest.fn();
    renderScreen(replace);

    expect(screen.getByText('隨機事件')).toBeTruthy();
    fireEvent.press(screen.getByText('強烈'));
    fireEvent.press(screen.getByText('開始對局'));
    expect(replace).toHaveBeenCalledWith(
      'OfflineGame',
      expect.objectContaining({ eventsMode: 'intense' }),
    );
  });
});
