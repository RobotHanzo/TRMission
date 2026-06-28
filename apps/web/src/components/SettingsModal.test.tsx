import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
