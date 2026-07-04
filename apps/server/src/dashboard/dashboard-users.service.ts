import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { UserFeature } from '@trm/shared';
import type { AuthUser } from '../auth/auth.types';
import { UserRepo, type UserDoc } from '../auth/user.repo';
import { SessionRepo } from '../auth/session.repo';
import { RoomRepo } from '../lobby/room.repo';
import { HistoryRepo } from '../history/history.repo';
import { DashboardAccountRepo } from './dashboard-account.repo';
import { AuditService } from './audit.service';
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
  features: u.features ?? [],
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
    private readonly audit: AuditService,
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

  /**
   * Ban: set the disabled marker, then revoke every refresh family — new sessions,
   * refreshes, and ws-game tickets are refused immediately. Already-minted access
   * tokens stay valid for up to 15 minutes on read-only REST (documented window).
   */
  async disable(actor: AuthUser, userId: string, reason?: string) {
    if (userId === actor.userId) throw new ForbiddenException('you cannot ban yourself');
    const target = await this.users.findById(userId);
    if (!target) throw new NotFoundException('user not found');
    if (await this.accounts.findById(userId)) {
      throw new ConflictException('target holds dashboard access — revoke it first');
    }
    await this.users.setDisabled(userId, actor.userId, reason);
    await this.sessions.revokeAllForUser(userId);
    await this.audit.log(actor, 'user.ban', { type: 'user', id: userId }, reason ? { reason } : {});
    return this.detail(userId);
  }

  async enable(actor: AuthUser, userId: string) {
    const target = await this.users.findById(userId);
    if (!target) throw new NotFoundException('user not found');
    await this.users.clearDisabled(userId);
    await this.audit.log(actor, 'user.unban', { type: 'user', id: userId });
    return this.detail(userId);
  }

  /** Replace a registered account's gated-feature set (dashboard `users.features`). */
  async setFeatures(actor: AuthUser, userId: string, features: UserFeature[]) {
    const target = await this.users.findById(userId);
    if (!target) throw new NotFoundException('user not found');
    if (target.isGuest) {
      throw new BadRequestException('features cannot be granted to guest accounts');
    }
    const deduped = [...new Set(features)];
    await this.users.setFeatures(userId, deduped);
    await this.audit.log(
      actor,
      'user.features',
      { type: 'user', id: userId },
      { before: target.features ?? [], after: deduped },
    );
    return this.detail(userId);
  }

  async listFeatured() {
    return { users: (await this.users.listFeatured()).map(toRow) };
  }
}
