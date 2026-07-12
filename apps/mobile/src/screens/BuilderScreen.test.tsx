import { render, screen, waitFor } from '@testing-library/react-native';

// Native modules: mock before importing the screen.
const mockWebView = jest.fn((_props: unknown) => null);
jest.mock('react-native-webview', () => ({ WebView: (p: unknown) => mockWebView(p) }));

let mockNetState = { isConnected: true };
jest.mock('@react-native-community/netinfo', () => ({
  useNetInfo: () => mockNetState,
}));

const mockMobileCarry = jest.fn();
jest.mock('../net/rest', () => ({
  api: { mobileCarry: (...a: unknown[]) => mockMobileCarry(...a) },
  setOnTokenChange: jest.fn(),
  setAccessToken: jest.fn(),
}));
jest.mock('../config', () => ({
  SERVER_ORIGIN: 'https://play.example',
}));

// The session store (useCanBuild) drags in secureStore + push/register → native modules.
jest.mock('../net/secureStore', () => ({
  getRefreshToken: jest.fn(),
  setRefreshToken: jest.fn(),
  clearRefreshToken: jest.fn(),
}));
jest.mock('../push/register', () => ({
  registerDeviceForPush: jest.fn(),
  unregisterDeviceForPush: jest.fn(),
}));

import BuilderScreen from './BuilderScreen';

describe('BuilderScreen', () => {
  beforeEach(() => {
    mockWebView.mockClear();
    mockMobileCarry.mockReset();
    mockNetState = { isConnected: true };
  });

  it('mints a fresh carry code and points the WebView at the handoff URL', async () => {
    mockMobileCarry.mockResolvedValue({ code: 'abc123' });
    render(<BuilderScreen />);
    await waitFor(() => expect(mockWebView).toHaveBeenCalled());
    const props = mockWebView.mock.calls.at(-1)![0] as { source: { uri: string } };
    expect(props.source.uri).toBe(
      'https://play.example/api/v1/auth/mobile-web-handoff?code=abc123',
    );
    expect(mockMobileCarry).toHaveBeenCalledTimes(1);
  });

  it('offline: renders the branded banner, never mounts the WebView', () => {
    mockNetState = { isConnected: false };
    render(<BuilderScreen />);
    expect(screen.getByTestId('builder-offline')).toBeTruthy();
    expect(mockWebView).not.toHaveBeenCalled();
  });

  it('carry mint failure renders the error state (no WebView with a broken URL)', async () => {
    mockMobileCarry.mockRejectedValue(new Error('401'));
    render(<BuilderScreen />);
    await waitFor(() => expect(screen.getByTestId('builder-error')).toBeTruthy());
    expect(mockWebView).not.toHaveBeenCalled();
  });
});
