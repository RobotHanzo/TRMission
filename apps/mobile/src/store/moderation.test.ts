import { useModeration } from './moderation';
import { api } from '../net/rest';

jest.mock('../net/rest', () => ({
  api: {
    myBlocks: jest.fn(),
    blockUser: jest.fn(),
    unblockUser: jest.fn(),
  },
}));

const mocked = api as unknown as {
  myBlocks: jest.Mock;
  blockUser: jest.Mock;
  unblockUser: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  useModeration.getState().reset();
});

describe('useModeration', () => {
  it('hydrate() populates blocked from the server list', async () => {
    mocked.myBlocks.mockResolvedValue({ blockedUserIds: ['u-bad', 'u-worse'] });
    await useModeration.getState().hydrate();
    expect(useModeration.getState().blocked.has('u-bad')).toBe(true);
    expect(useModeration.getState().blocked.has('u-worse')).toBe(true);
    expect(useModeration.getState().hydrated).toBe(true);
  });

  it('hydrate() failure is non-fatal and leaves filtering off', async () => {
    mocked.myBlocks.mockRejectedValue(new Error('offline'));
    await useModeration.getState().hydrate();
    expect(useModeration.getState().blocked.size).toBe(0);
    expect(useModeration.getState().hydrated).toBe(false);
  });

  it('block() is optimistic and sticks on success', async () => {
    mocked.blockUser.mockResolvedValue(undefined);
    const p = useModeration.getState().block('u-bad');
    expect(useModeration.getState().blocked.has('u-bad')).toBe(true); // optimistic
    await p;
    expect(useModeration.getState().blocked.has('u-bad')).toBe(true);
    expect(mocked.blockUser).toHaveBeenCalledWith('u-bad');
  });

  it('block() rolls back when the API fails', async () => {
    mocked.blockUser.mockRejectedValue(new Error('409'));
    await useModeration.getState().block('u-bad');
    expect(useModeration.getState().blocked.has('u-bad')).toBe(false);
  });

  it('unblock() removes optimistically and restores on failure', async () => {
    mocked.myBlocks.mockResolvedValue({ blockedUserIds: ['u-bad'] });
    await useModeration.getState().hydrate();

    mocked.unblockUser.mockResolvedValue(undefined);
    await useModeration.getState().unblock('u-bad');
    expect(useModeration.getState().blocked.has('u-bad')).toBe(false);

    mocked.blockUser.mockResolvedValue(undefined);
    await useModeration.getState().block('u-bad');
    mocked.unblockUser.mockRejectedValue(new Error('offline'));
    await useModeration.getState().unblock('u-bad');
    expect(useModeration.getState().blocked.has('u-bad')).toBe(true); // rolled back
  });

  it('reset() clears the list and the hydrated flag', async () => {
    mocked.myBlocks.mockResolvedValue({ blockedUserIds: ['u-bad'] });
    await useModeration.getState().hydrate();
    useModeration.getState().reset();
    expect(useModeration.getState().blocked.size).toBe(0);
    expect(useModeration.getState().hydrated).toBe(false);
  });
});
