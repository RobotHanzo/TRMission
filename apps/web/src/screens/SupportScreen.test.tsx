import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '../i18n';
import SupportScreen from './SupportScreen';
import { useSession } from '../store/session';
import { api, ApiError } from '../net/rest';

vi.mock('../net/connection', () => ({ disconnectGame: vi.fn(), connectGame: vi.fn() }));
vi.mock('../net/rest', () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    setOnTokenChange: vi.fn(),
    setAccessToken: vi.fn(),
    api: { supportConfig: vi.fn(), submitSupport: vi.fn() },
  };
});

const mocked = api as unknown as {
  supportConfig: ReturnType<typeof vi.fn>;
  submitSupport: ReturnType<typeof vi.fn>;
};

/** Fill the two required fields (subject + a message over the 10-char floor). */
function fillForm(): void {
  fireEvent.change(screen.getByLabelText(/subject|主旨/i), {
    target: { value: 'Stuck in a game' },
  });
  fireEvent.change(screen.getByLabelText(/details|詳細說明/i), {
    target: { value: 'The board never advances past my turn.' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useSession.setState({ user: null });
  mocked.supportConfig.mockResolvedValue({ formEnabled: true });
  mocked.submitSupport.mockResolvedValue({ delivered: true });
});

describe('SupportScreen', () => {
  it('renders the self-serve answers and both contact channels without an account', async () => {
    render(<SupportScreen />);
    // The FAQ answers are the point of the page for Apple 1.5 — not just the form.
    expect(screen.getByRole('heading', { name: /常見問題|Common questions/i })).toBeTruthy();
    expect(screen.getByText('trmission@robothanzo.dev')).toBeTruthy();
    await waitFor(() => expect(mocked.supportConfig).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /send|送出/i })).toBeTruthy();
  });

  it('submits the form and shows the confirmation', async () => {
    render(<SupportScreen />);
    await waitFor(() => expect(mocked.supportConfig).toHaveBeenCalled());
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /^(send|送出)$/i }));

    await waitFor(() => expect(mocked.submitSupport).toHaveBeenCalledTimes(1));
    expect(mocked.submitSupport.mock.calls[0]![0]).toMatchObject({
      category: 'BUG',
      subject: 'Stuck in a game',
      platform: 'web',
    });
    await waitFor(() => expect(screen.getByText(/thank you|謝謝你/i)).toBeTruthy());
  });

  it('keeps the submit button disabled until subject and message are filled', async () => {
    render(<SupportScreen />);
    await waitFor(() => expect(mocked.supportConfig).toHaveBeenCalled());
    const button = screen.getByRole('button', { name: /^(send|送出)$/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fillForm();
    expect(button.disabled).toBe(false);
  });

  it('replaces the form with a notice when the deployment has no inbox', async () => {
    mocked.supportConfig.mockResolvedValue({ formEnabled: false });
    render(<SupportScreen />);
    await waitFor(() =>
      expect(screen.getByText(/not enabled on this deployment|未啟用線上表單/i)).toBeTruthy(),
    );
    expect(screen.queryByRole('button', { name: /^(send|送出)$/i })).toBeNull();
  });

  it('surfaces the rate limit rather than a generic failure', async () => {
    mocked.submitSupport.mockRejectedValue(new ApiError(429, 'Too Many Requests'));
    render(<SupportScreen />);
    await waitFor(() => expect(mocked.supportConfig).toHaveBeenCalled());
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: /^(send|送出)$/i }));
    await waitFor(() => expect(screen.getByText(/short time|短時間內送出太多訊息/i)).toBeTruthy());
  });
});
