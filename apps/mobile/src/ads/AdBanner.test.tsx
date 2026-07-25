jest.mock('../config', () => ({
  ...jest.requireActual('../config'),
  ADMOB_ENABLED: true,
}));

// `mock`-prefixed so babel-jest allows the hoisted factory to close over it.
let mockFocused = true;
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));

// No SafeAreaProvider is mounted in this tree — same stub the screen tests use.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { render, screen } from '@testing-library/react-native';
import '../i18n';
import type { UserFeature } from '@trm/shared';
import { useAds } from './ads';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { AdBanner } from './AdBanner';

const user = (features: UserFeature[]) => ({
  id: 'u1',
  displayName: 'Rider',
  isGuest: false,
  features,
});

describe('AdBanner', () => {
  beforeEach(() => {
    mockFocused = true;
    useAds.setState({ ready: true, privacyOptionsRequired: false });
    useSession.setState({ user: user([]) as never });
    useUi.setState({ hideAds: false });
  });

  it('renders once the SDK is up and consent allows ads', () => {
    render(<AdBanner />);
    expect(screen.queryByTestId('ad-banner')).not.toBeNull();
  });

  it('renders nothing before the SDK is up — no request may precede consent', () => {
    useAds.setState({ ready: false });
    render(<AdBanner />);
    expect(screen.queryByTestId('ad-banner')).toBeNull();
  });

  it('renders nothing on an unfocused tab', () => {
    // Native bottom tabs keep every tab mounted; without this the app would hold four live banner
    // requests and burn impressions on screens nobody is looking at.
    mockFocused = false;
    render(<AdBanner />);
    expect(screen.queryByTestId('ad-banner')).toBeNull();
  });

  it('is suppressed for an adFree account that has toggled ads off', () => {
    useSession.setState({ user: user(['adFree']) as never });
    useUi.setState({ hideAds: true });
    render(<AdBanner />);
    expect(screen.queryByTestId('ad-banner')).toBeNull();
  });

  it('still shows for an adFree account that has NOT toggled ads off', () => {
    useSession.setState({ user: user(['adFree']) as never });
    render(<AdBanner />);
    expect(screen.queryByTestId('ad-banner')).not.toBeNull();
  });

  it('ignores a stored hideAds flag without the adFree feature (no opt-out bypass)', () => {
    useUi.setState({ hideAds: true });
    render(<AdBanner />);
    expect(screen.queryByTestId('ad-banner')).not.toBeNull();
  });
});
