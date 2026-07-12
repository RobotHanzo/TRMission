import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserRepo } from '../auth/user.repo';
import { SessionRepo } from '../auth/session.repo';
import { RoomRepo } from '../lobby/room.repo';
import { HistoryRepo } from '../history/history.repo';
import { CustomMapRepo } from '../maps/custom-map.repo';
import { DashboardAccountRepo } from '../dashboard/dashboard-account.repo';
import { DeviceRepo } from '../push/device.repo';
import { RatingsRepo } from '../ratings/ratings.repo';
import { APPLE_TOKEN_REVOKER, type AppleTokenRevoker } from './apple-token-revoker';
import type { AuthUser } from '../auth/auth.types';

/**
 * Self-service account deletion (Apple 5.1.1(v) + Play requirement). Cascade follows the
 * system's dangling-id posture (guest TTL deletion already leaves opaque ids everywhere):
 * delete the PII-bearing rows, leave the deterministic game log and immutable map contents
 * intact — a uuid with no users doc behind it is anonymous.
 */
@Injectable()
export class AccountDeletionService {
  constructor(
    private readonly users: UserRepo,
    private readonly sessions: SessionRepo,
    private readonly rooms: RoomRepo,
    private readonly history: HistoryRepo,
    private readonly customMaps: CustomMapRepo,
    private readonly dashboardAccounts: DashboardAccountRepo,
    private readonly devices: DeviceRepo,
    private readonly ratings: RatingsRepo,
    @Inject(APPLE_TOKEN_REVOKER) private readonly appleRevoker: AppleTokenRevoker,
  ) {}

  async deleteAccount(user: AuthUser, appleAuthorizationCode?: string): Promise<void> {
    const doc = await this.users.findById(user.userId);
    if (!doc) throw new UnauthorizedException('user not found');
    // Same protection order as the ban flow: dashboard access must be revoked first (409).
    if (await this.dashboardAccounts.findById(user.userId)) {
      throw new ConflictException('account holds dashboard access — revoke it first');
    }

    // Best-effort Apple revocation BEFORE the doc disappears (TN3194 allows proceeding on failure).
    if (doc.oauth?.apple && appleAuthorizationCode) {
      await this.appleRevoker.revoke(appleAuthorizationCode);
    }

    // LOBBY rooms: the existing leave() handles reseating, host transfer, and closing.
    for (const room of await this.rooms.findActiveByMember(user.userId)) {
      if (room.status === 'LOBBY') await this.rooms.leave(room._id, user.userId);
    }
    await this.history.pullSpectator(user.userId);
    await this.customMaps.deleteByOwner(user.userId);
    await this.ratings.deleteByUser(user.userId);
    await this.devices.deleteAllForUser(user.userId);
    await this.sessions.deleteAllForUser(user.userId);
    await this.users.deleteById(user.userId);
  }
}
