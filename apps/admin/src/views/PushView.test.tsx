import { describe, it, expect, beforeEach, vi } from 'vitest';
import type * as RestModule from '../net/rest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../i18n';
import { PushView } from './PushView';
import { api, type UserRow } from '../net/rest';
import { useToast } from '../store/toast';
import { ToastStack } from '../components/ToastStack';

vi.mock('../net/rest', async (importOriginal) => {
  const mod = await importOriginal<typeof RestModule>();
  return {
    ...mod,
    api: {
      ...mod.api,
      getPushStatus: vi.fn(),
      sendTestPush: vi.fn(),
      listUsers: vi.fn(),
    },
  };
});
const mocked = api as unknown as {
  getPushStatus: ReturnType<typeof vi.fn>;
  sendTestPush: ReturnType<typeof vi.fn>;
  listUsers: ReturnType<typeof vi.fn>;
};

const row = (over: Partial<UserRow> = {}): UserRow => ({
  id: 'u1',
  displayName: 'Alice',
  isGuest: false,
  oauthProviders: [],
  hasPassword: false,
  features: [],
  tutorialCompleted: true,
  createdAt: '2026-07-01T00:00:00.000Z',
  ...over,
});

async function pickTarget() {
  mocked.listUsers.mockResolvedValue({ users: [row()], nextCursor: null });
  fireEvent.click(await screen.findByText('選擇帳號'));
  fireEvent.click(await screen.findByText('Alice'));
}

describe('PushView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToast.getState().reset();
  });

  it('shows an enabled status badge', async () => {
    mocked.getPushStatus.mockResolvedValue({ enabled: true });
    render(<PushView />);
    expect(await screen.findByText('推播已啟用')).toBeInTheDocument();
  });

  it('shows a disabled status badge', async () => {
    mocked.getPushStatus.mockResolvedValue({ enabled: false });
    render(<PushView />);
    expect(await screen.findByText('尚未設定推播憑證(FCM/APNs)')).toBeInTheDocument();
  });

  it('disables send until a target is picked', async () => {
    mocked.getPushStatus.mockResolvedValue({ enabled: true });
    render(<PushView />);
    expect(await screen.findByText('發送測試推播')).toBeDisabled();
  });

  it('sends the picked kind to the picked user and shows a success toast', async () => {
    mocked.getPushStatus.mockResolvedValue({ enabled: true });
    mocked.sendTestPush.mockResolvedValue({ enabled: true, deviceCount: 1, sent: 1, failed: 0 });
    render(
      <>
        <PushView />
        <ToastStack />
      </>,
    );
    await pickTarget();
    fireEvent.click(screen.getByText('發送測試推播'));
    expect(mocked.sendTestPush).toHaveBeenCalledWith('u1', 'your_turn');
    expect(await screen.findByText('已發送至 1 台裝置')).toBeInTheDocument();
  });

  it('shows a no-devices toast', async () => {
    mocked.getPushStatus.mockResolvedValue({ enabled: true });
    mocked.sendTestPush.mockResolvedValue({ enabled: true, deviceCount: 0, sent: 0, failed: 0 });
    render(
      <>
        <PushView />
        <ToastStack />
      </>,
    );
    await pickTarget();
    fireEvent.click(screen.getByText('發送測試推播'));
    expect(await screen.findByText('此帳號尚未註冊任何裝置')).toBeInTheDocument();
  });

  it('shows a disabled-result toast when push has no transport configured', async () => {
    mocked.getPushStatus.mockResolvedValue({ enabled: false });
    mocked.sendTestPush.mockResolvedValue({ enabled: false, deviceCount: 0, sent: 0, failed: 0 });
    render(
      <>
        <PushView />
        <ToastStack />
      </>,
    );
    await pickTarget();
    fireEvent.click(screen.getByText('發送測試推播'));
    expect(await screen.findByText('推播尚未啟用(伺服器未設定 FCM/APNs 憑證)')).toBeInTheDocument();
  });
});
