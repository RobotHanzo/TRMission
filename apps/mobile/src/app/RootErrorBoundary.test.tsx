jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest'),
);
jest.mock('expo-splash-screen', () => ({
  hideAsync: jest.fn(() => Promise.resolve()),
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
}));
import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import '../i18n';
import * as Sentry from '@sentry/react-native';
import { RootErrorBoundary } from './RootErrorBoundary';
import { getLastCrash } from './crashCapture';

// Throws while armed (React 19 retries a throwing render once, so the bomb must stay armed
// through both attempts); the test disarms it before pressing retry so the remount recovers.
let armed = true;
function Bomb(): React.JSX.Element {
  if (armed) throw new Error('kaboom');
  return <Text testID="alive">ok</Text>;
}

describe('RootErrorBoundary', () => {
  it('catches a render error, records it, and recovers via retry', async () => {
    // React logs caught boundary errors; keep the test output clean.
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const screen = render(
        <RootErrorBoundary>
          <Bomb />
        </RootErrorBoundary>,
      );
      expect(screen.getByTestId('crash-fallback')).toBeTruthy();
      expect(screen.queryByTestId('alive')).toBeNull();

      armed = false;
      fireEvent.press(screen.getByTestId('crash-retry'));
      expect(screen.getByTestId('alive')).toBeTruthy();

      const rec = await getLastCrash();
      expect(rec?.message).toBe('Error: kaboom');
      expect(rec?.source).toBe('boundary');

      // The local record above is the offline fallback; the same error also goes out to Sentry
      // (a no-op without a DSN — __mocks__/@sentry/react-native.js stands in for the uninit'd SDK).
      expect(Sentry.captureException).toHaveBeenCalled();
      const [reported] = (Sentry.captureException as jest.Mock).mock.calls[0] as [unknown];
      expect((reported as Error).message).toBe('kaboom');
    } finally {
      quiet.mockRestore();
    }
  });
});
