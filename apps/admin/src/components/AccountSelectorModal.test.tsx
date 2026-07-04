import { describe, it, expect, beforeEach, vi } from 'vitest';
import type * as RestModule from '../net/rest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../i18n';
import { AccountSelectorModal } from './AccountSelectorModal';
import { api, type UserRow } from '../net/rest';

vi.mock('../net/rest', async (importOriginal) => {
  const mod = await importOriginal<typeof RestModule>();
  return { ...mod, api: { ...mod.api, listUsers: vi.fn() } };
});
const mocked = api as unknown as { listUsers: ReturnType<typeof vi.fn> };

const row = (over: Partial<UserRow> = {}): UserRow => ({
  id: 'u1',
  displayName: 'Alice',
  email: 'alice@example.com',
  isGuest: false,
  oauthProviders: [],
  features: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  ...over,
});

describe('AccountSelectorModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists registered accounts and reports the clicked one', async () => {
    mocked.listUsers.mockResolvedValue({ users: [row()], nextCursor: null });
    const onSelect = vi.fn();
    render(<AccountSelectorModal title="pick" onSelect={onSelect} onClose={() => {}} />);
    fireEvent.click(await screen.findByText('Alice'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }));
    expect(mocked.listUsers).toHaveBeenCalledWith(
      expect.objectContaining({ filter: 'registered' }),
    );
  });

  it('hides excluded ids and closes on Escape', async () => {
    mocked.listUsers.mockResolvedValue({
      users: [row(), row({ id: 'u2', displayName: 'Bob' })],
      nextCursor: null,
    });
    const onClose = vi.fn();
    render(
      <AccountSelectorModal
        title="pick"
        excludeIds={['u1']}
        onSelect={() => {}}
        onClose={onClose}
      />,
    );
    expect(await screen.findByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
