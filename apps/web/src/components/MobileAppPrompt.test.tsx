import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '../i18n';
import { MobileAppPrompt } from './MobileAppPrompt';
import { useUi } from '../store/ui';
import { useSession } from '../store/session';

const track = vi.hoisted(() => vi.fn());
vi.mock('../lib/analytics', () => ({ track }));

const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const CHROME_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function asDevice(userAgent: string, platform: string, maxTouchPoints: number): void {
  for (const [key, value] of Object.entries({ userAgent, platform, maxTouchPoints })) {
    Object.defineProperty(navigator, key, { value, configurable: true });
  }
}

/** Past the settle delay the sheet waits out (SETTLE_MS), plus slack. */
const settle = () => act(() => void vi.advanceTimersByTime(1000));

const sheet = () => screen.queryByRole('dialog');

describe('MobileAppPrompt (the "get the app" sheet, issue #106)', () => {
  const originalUa = navigator.userAgent;

  beforeEach(() => {
    vi.useFakeTimers();
    track.mockClear();
    localStorage.clear();
    asDevice(SAFARI_IPHONE, 'iPhone', 5);
    useUi.setState({ view: 'home' });
    useSession.setState({ booting: false });
  });
  afterEach(() => {
    vi.useRealTimers();
    asDevice(originalUa, 'MacIntel', 0);
  });

  it('offers the App Store and a way to stay on the web, once the page has settled', () => {
    render(<MobileAppPrompt />);
    expect(sheet()).not.toBeInTheDocument(); // never on the first frame
    settle();

    expect(sheet()).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '從 App Store 下載' })).toHaveAttribute(
      'href',
      'https://trmission.robothanzo.dev/ios',
    );
    expect(screen.getByRole('button', { name: '留在瀏覽器繼續玩' })).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith('app_prompt_shown', { platform: 'ios' });
  });

  it('"keep playing in the browser" closes it for good on this device', () => {
    const { unmount } = render(<MobileAppPrompt />);
    settle();
    fireEvent.click(screen.getByRole('button', { name: '留在瀏覽器繼續玩' }));

    expect(sheet()).not.toBeInTheDocument();
    expect(track).toHaveBeenCalledWith('app_prompt_dismiss', {});
    expect(localStorage.getItem('trm.appPromptDismissed')).toBe('1');

    unmount();
    render(<MobileAppPrompt />);
    settle();
    expect(sheet()).not.toBeInTheDocument();
  });

  it('Escape and the backdrop dismiss it too', () => {
    const { unmount } = render(<MobileAppPrompt />);
    settle();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(sheet()).not.toBeInTheDocument();

    unmount();
    localStorage.clear();
    const { container } = render(<MobileAppPrompt />);
    settle();
    fireEvent.click(container.querySelector('.app-prompt-backdrop')!);
    expect(sheet()).not.toBeInTheDocument();
  });

  it('leaving for the store also closes it, so it is not waiting on return', () => {
    render(<MobileAppPrompt />);
    settle();
    fireEvent.click(screen.getByRole('link', { name: '從 App Store 下載' }));

    expect(track).toHaveBeenCalledWith('app_store_click', { source: 'mobile_prompt' });
    expect(sheet()).not.toBeInTheDocument();
    expect(localStorage.getItem('trm.appPromptDismissed')).toBe('1');
  });

  it('never renders on a desktop browser', () => {
    asDevice(CHROME_DESKTOP, 'Win32', 0);
    render(<MobileAppPrompt />);
    settle();
    expect(sheet()).not.toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
  });

  it('stays out of immersive and account-sensitive views', () => {
    for (const view of ['game', 'tutorial', 'support', 'deleteAccount'] as const) {
      useUi.setState({ view });
      const { unmount } = render(<MobileAppPrompt />);
      settle();
      expect(sheet()).not.toBeInTheDocument();
      unmount();
    }
  });

  it('waits for the session probe rather than covering a booting page', () => {
    useSession.setState({ booting: true });
    render(<MobileAppPrompt />);
    settle();
    expect(sheet()).not.toBeInTheDocument();

    act(() => useSession.setState({ booting: false }));
    expect(sheet()).toBeInTheDocument();
  });
});
