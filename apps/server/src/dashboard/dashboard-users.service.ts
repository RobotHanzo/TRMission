import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRepo, type UserDoc } from '../auth/user.repo';
import { SessionRepo } from '../auth/session.repo';
import { RoomRepo } from '../lobby/room.repo';
import { HistoryRepo } from '../history/history.repo';
import { DashboardAccountRepo } from './dashboard-account.repo';
import { decodeCursor, encodeCursor } from './cursor';

/**
 * Explicit projection — never spread the doc. passwordHash, oauth subject ids, and
 * tokenVersion must not reach the dashboard wire.
 */
const toRow = (u: UserDoc) => ({
  id: u._id,
  displayName: u.displayName,
  ...(u.email ? { email: u.email } : {}),
  isGuest: u.isGuest,
  ...(u.avatarUrl ? { avatarUrl: u.avatarUrl } : {}),
  oauthProviders: Object.keys(u.oauth ?? {}),
  createdAt: u.createdAt.toISOString(),
  ...(u.disabledAt ? { disabledAt: u.disabledAt.toISOString() } : {}),
});

@Injectable()
export class DashboardUsersService {
  constructor(
    private readonly users: UserRepo,
    private readonly sessions: SessionRepo,
    private readonly rooms: RoomRepo,
    private readonly history: HistoryRepo,
    private readonly accounts: DashboardAccountRepo,
  ) {}

  async list(query: {
    q?: string | undefined;
    filter: 'all' | 'guests' | 'registered' | 'disabled';
    limit: number;
    cursor?: string | undefined;
  }) {
    if (query.q) {
      // Search is a bounded top-N, not a paged listing.
      const docs = await this.users.search(query.q, query.limit);
      return { users: docs.map(toRow), nextCursor: null };
    }
    const docs = await this.users.listPage(query.filter, query.limit, decodeCursor(query.cursor));
    const last = docs.length === query.limit ? docs[docs.length - 1] : undefined;
    return {
      users: docs.map(toRow),
      nextCursor: last ? encodeCursor(last.createdAt, last._id) : null,
    };
  }

  async detail(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('user not found');
    const [activeSessions, activeRooms, history, account] = await Promise.all([
      this.sessions.countActiveForUser(userId),
      this.rooms.findActiveByMember(userId),
      this.history.listForUser(userId, 20),
      this.accounts.findById(userId),
    ]);
    return {
      ...toRow(user),
      ...(user.preferences?.locale ? { locale: user.preferences.locale } : {}),
      ...(user.disabledBy ? { disabledBy: user.disabledBy } : {}),
      ...(user.disabledReason ? { disabledReason: user.disabledReason } : {}),
      activeSessions,
      activeRooms: activeRooms.map((r) => ({ code: r._id, status: r.status })),
      history,
      isMaintainer: account !== null,
    };
  }
}
