import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { effectivePermissions } from '@trm/shared';
import type { AuthUser } from '../auth/auth.types';
import { UserRepo } from '../auth/user.repo';
import {
  DashboardAccountRepo,
  type DashboardAccountDoc,
  type DashboardAccountPatch,
} from './dashboard-account.repo';
import { AuditService } from './audit.service';

const overridesOf = (doc: DashboardAccountDoc | DashboardAccountPatch) => ({
  role: doc.role,
  extraPermissions: doc.extraPermissions ?? [],
  deniedPermissions: doc.deniedPermissions ?? [],
});

@Injectable()
export class DashboardMaintainersService {
  constructor(
    private readonly accounts: DashboardAccountRepo,
    private readonly users: UserRepo,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const accounts = await this.accounts.list();
    const userIds = accounts.map((a) => a._id);
    const users = new Map(
      await Promise.all(
        userIds.map(
          async (id) => [id, await this.users.findById(id)] as const, // point reads by _id
        ),
      ),
    );
    return {
      maintainers: accounts.map((a) => {
        const user = users.get(a._id) ?? null;
        return {
          userId: a._id,
          role: a.role,
          extraPermissions: a.extraPermissions ?? [],
          deniedPermissions: a.deniedPermissions ?? [],
          permissions: [
            ...effectivePermissions(a.role, a.extraPermissions, a.deniedPermissions),
          ].sort(),
          grantedBy: a.grantedBy,
          grantedAt: a.grantedAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
          // A TTL-expired guest (or deleted user) leaves a dangling record — surfaced, not hidden.
          dangling: user === null,
          ...(user
            ? {
                displayName: user.displayName,
                ...(user.email ? { email: user.email } : {}),
              }
            : {}),
        };
      }),
    };
  }

  /**
   * Grant or update a maintainer. Self-modification is forbidden outright (one rule
   * covers self-demotion, self-permission-stripping, and most lockout paths), and the
   * last owner can never be demoted. The count check is a benign TOCTOU race between
   * two concurrent owners — no transactions in this codebase; boot seeding re-heals.
   */
  async put(actor: AuthUser, userId: string, patch: DashboardAccountPatch) {
    if (userId === actor.userId) {
      throw new ForbiddenException('another owner must change your own access');
    }
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('user not found');
    if (user.isGuest) throw new BadRequestException('guests cannot be maintainers');
    if (user.disabledAt) throw new BadRequestException('account is disabled — lift the ban first');

    const existing = await this.accounts.findById(userId);
    if (existing?.role === 'owner' && patch.role !== 'owner') {
      if ((await this.accounts.countOwners()) <= 1) {
        throw new ConflictException('cannot demote the last owner');
      }
    }
    const doc = await this.accounts.upsert(userId, patch, actor.userId);
    await this.audit.log(
      actor,
      existing ? 'maintainer.update' : 'maintainer.grant',
      { type: 'maintainer', id: userId },
      { ...(existing ? { from: overridesOf(existing) } : {}), to: overridesOf(patch) },
    );
    return {
      userId: doc._id,
      role: doc.role,
      extraPermissions: doc.extraPermissions ?? [],
      deniedPermissions: doc.deniedPermissions ?? [],
      permissions: [
        ...effectivePermissions(doc.role, doc.extraPermissions, doc.deniedPermissions),
      ].sort(),
      grantedBy: doc.grantedBy,
      grantedAt: doc.grantedAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
      dangling: false,
      displayName: user.displayName,
      ...(user.email ? { email: user.email } : {}),
    };
  }

  async revoke(actor: AuthUser, userId: string): Promise<void> {
    if (userId === actor.userId) {
      throw new ForbiddenException('another owner must revoke your own access');
    }
    const existing = await this.accounts.findById(userId);
    if (!existing) throw new NotFoundException('not a maintainer');
    if (existing.role === 'owner' && (await this.accounts.countOwners()) <= 1) {
      throw new ConflictException('cannot revoke the last owner');
    }
    await this.accounts.remove(userId);
    await this.audit.log(
      actor,
      'maintainer.revoke',
      { type: 'maintainer', id: userId },
      { previousRole: existing.role },
    );
  }
}
