import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { UserFeature } from '@trm/shared';
import '../i18n';
import { SettingsModal } from './SettingsModal';
import { useUi } from '../store/ui';
import { useSession } from '../store/session';

// SettingsModal only needs the store; stub the socket teardown the ui store imports.
vi.mock('../net/connection', () => ({ disconnectGame: vi.fn() }));

describe('SettingsModal account sync', () => {
  let saved: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    localStorage.clear();
    saved = vi.fn();
    useSession.setState({ savePreferences: saved });
    useUi.setState({ theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' });
  });

  it('saves the full preference set to the account when the language changes', () => {
    render(<SettingsModal onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('radio', { name: 'English' }));

    expect(useUi.getState().locale).toBe('en');
    expect(saved).toHaveBeenCalledWith({
      theme: 'system',
      colorBlind: false,
      locale: 'en',
      boardLayout: 'rail',
    });
  });

  it('saves the full preference set to the account when the layout changes', () => {
    render(<SettingsModal onClose={() => undefined} />);
    // Layout labels are i18n strings; zh-Hant is the default, so 底部牌列 = the 'tray' option.
    fireEvent.click(screen.getByRole('radio', { name: '底部牌列' }));

    expect(useUi.getState().boardLayout).toBe('tray');
    expect(saved).toHaveBeenCalledWith({
      theme: 'system',
      colorBlind: false,
      locale: 'zh-Hant',
      boardLayout: 'tray',
    });
  });
});

describe('SettingsModal sound section', () => {
  beforeEach(() => {
    localStorage.clear();
    useSession.setState({ savePreferences: vi.fn() });
    useUi.setState({
      theme: 'system',
      colorBlind: false,
      locale: 'zh-Hant',
      boardLayout: 'rail',
      soundEnabled: true,
      soundVolume: 0.6,
    });
  });

  it('toggles mute and writes through to the store', () => {
    render(<SettingsModal onClose={() => undefined} />);
    const sw = screen.getByRole('switch', { name: /sound|音效/i });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    expect(useUi.getState().soundEnabled).toBe(false);
  });

  it('changes volume via the slider', () => {
    render(<SettingsModal onClose={() => undefined} />);
    const slider = screen.getByRole('slider', { name: /volume|音量/i });
    fireEvent.change(slider, { target: { value: '0.3' } });
    expect(useUi.getState().soundVolume).toBeCloseTo(0.3);
  });

  it('mutes via the volume icon shortcut', () => {
    render(<SettingsModal onClose={() => undefined} />);
    const muteBtn = screen.getByRole('button', { name: /sound|音效/i });
    expect(muteBtn).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(muteBtn);

    expect(useUi.getState().soundEnabled).toBe(false);
    expect(muteBtn).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('SettingsModal ad opt-out (feature-gated)', () => {
  const adFreeUser = {
    id: 'u1',
    displayName: 'Tester',
    isGuest: false,
    preferences: { theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' },
    features: ['adFree'] as UserFeature[],
    tutorialCompleted: true,
  } as const;

  beforeEach(() => {
    localStorage.clear();
    useSession.setState({ savePreferences: vi.fn(), user: null });
    useUi.setState({
      theme: 'system',
      colorBlind: false,
      locale: 'zh-Hant',
      boardLayout: 'rail',
      hideAds: false,
    });
  });

  it('hides the toggle for accounts without the adFree feature', () => {
    render(<SettingsModal onClose={() => undefined} />);
    expect(screen.queryByRole('switch', { name: /廣告|hide ads/i })).toBeNull();
  });

  it('shows the toggle and writes the preference for adFree accounts', () => {
    useSession.setState({ user: { ...adFreeUser } });
    render(<SettingsModal onClose={() => undefined} />);
    const sw = screen.getByRole('switch', { name: /廣告|hide ads/i });
    expect(sw).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(sw);

    expect(useUi.getState().hideAds).toBe(true);
  });
});
