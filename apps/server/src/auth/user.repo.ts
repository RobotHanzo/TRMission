import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Collection, Db } from 'mongodb';
import type { UserFeature } from '@trm/shared';
import { MONGO_DB } from '../db/tokens';
import { env } from '../config/env';
import type { Locale, PublicUser, UserPreferences } from './auth.types';
import { DEFAULT_PREFERENCES } from './auth.types';
import type { OauthProvider } from './auth-config';

export interface UserDoc {
  _id: string;
  displayName: string;
  isGuest: boolean;
  locale?: Locale; // legacy: superseded by preferences.locale; kept for pre-unification docs
  preferences?: UserPreferences; // optional for back-compat with pre-preferences docs
  email?: string;
  passwordHash?: string;
  /** Linked OAuth identities: provider → the provider's subject id. Binding key stays `email`. */
  oauth?: Partial<Record<OauthProvider, string>>;
  /** Avatar URL carried over from an OAuth provider (refreshed on each OAuth sign-in). */
  avatarUrl?: string;
  tokenVersion: number;
  createdAt: Date;
  guestExpiresAt?: Date; // TTL-expired for abandoned guests
  /** Set while the account is banned from the maintainer dashboard (absent = active). */
  disabledAt?: Date;
  disabledBy?: string; // maintainer userId
  disabledReason?: string;
  /** Dashboard-granted gated features (absent/empty = none — the default for everyone). */
  features?: UserFeature[];
  /** Set once the user reaches the guided tutorial's finale (self-reported by the client). */
  tutorialCompleted?: boolean;
}

export const toPublicUser = (u: UserDoc): PublicUser => ({
  id: u._id,
  displayName: u.displayName,
  isGuest: u.isGuest,
  features: u.features ?? [],
  tutorialCompleted: u.tutorialCompleted ?? false,
  // Merge stored prefs over the defaults so docs written before a field existed still get a
  // complete set; a legacy top-level `locale` is honoured when the prefs blob predates it.
  preferences: {
    ...DEFAULT_PREFERENCES,
    ...(u.locale ? { locale: u.locale } : {}),
    ...u.preferences,
  },
  ...(u.email ? { email: u.email } : {}),
  ...(u.avatarUrl ? { avatarUrl: u.avatarUrl } : {}),
});

@Injectable()
export class UserRepo implements OnModuleInit {
  private readonly col: Collection<UserDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<UserDoc>('users');
  }

  async onModuleInit(): Promise<void> {
    await this.col.createIndex({ email: 1 }, { unique: true, sparse: true });
    await this.col.createIndex({ guestExpiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.col.createIndex({ createdAt: -1 }); // dashboard user listing/new-signup counts
  }

  findById(id: string): Promise<UserDoc | null> {
    return this.col.findOne({ _id: id });
  }

  findByEmail(email: string): Promise<UserDoc | null> {
    return this.col.findOne({ email: email.toLowerCase() });
  }

  async createGuest(displayName: string, locale: Locale): Promise<UserDoc> {
    const doc: UserDoc = {
      _id: randomUUID(),
      displayName,
      isGuest: true,
      preferences: { ...DEFAULT_PREFERENCES, locale },
      tokenVersion: 0,
      createdAt: new Date(),
      guestExpiresAt: new Date(Date.now() + env.guestTtlMs),
    };
    await this.col.insertOne(doc);
    return doc;
  }

  async createRegistered(
    email: string,
    passwordHash: string,
    displayName: string,
    locale: Locale,
  ): Promise<UserDoc> {
    const doc: UserDoc = {
      _id: randomUUID(),
      displayName,
      isGuest: false,
      preferences: { ...DEFAULT_PREFERENCES, locale },
      email: email.toLowerCase(),
      passwordHash,
      tokenVersion: 0,
      createdAt: new Date(),
    };
    await this.col.insertOne(doc);
    return doc;
  }

  updatePreferences(userId: string, preferences: UserPreferences): Promise<UserDoc | null> {
    return this.col.findOneAndUpdate(
      { _id: userId },
      { $set: { preferences } },
      { returnDocument: 'after' },
    );
  }

  /** Upgrade a guest in place (keeps the same _id and game history). */
  async upgradeGuest(userId: string, email: string, passwordHash: string): Promise<UserDoc | null> {
    return this.col.findOneAndUpdate(
      { _id: userId, isGuest: true },
      {
        $set: { isGuest: false, email: email.toLowerCase(), passwordHash },
        $unset: { guestExpiresAt: '' },
        $inc: { tokenVersion: 1 },
      },
      { returnDocument: 'after' },
    );
  }

  /**
   * Upgrade a guest in place via OAuth: attach the verified email + provider identity, keep the
   * same _id (and match history), no password. Bumps tokenVersion like the password upgrade since
   * the account's nature changed. Only succeeds while the doc is still a guest.
   */
  async attachOauthToGuest(
    userId: string,
    email: string,
    provider: OauthProvider,
    sub: string,
    avatarUrl: string | null,
  ): Promise<UserDoc | null> {
    return this.col.findOneAndUpdate(
      { _id: userId, isGuest: true },
      {
        $set: {
          isGuest: false,
          email: email.toLowerCase(),
          [`oauth.${provider}`]: sub,
          ...(avatarUrl ? { avatarUrl } : {}),
        },
        $unset: { guestExpiresAt: '' },
        $inc: { tokenVersion: 1 },
      },
      { returnDocument: 'after' },
    );
  }

  /** Record a provider identity on an existing account (idempotent re-link); refresh the avatar. */
  linkOauthIdentity(
    userId: string,
    provider: OauthProvider,
    sub: string,
    avatarUrl: string | null,
  ): Promise<UserDoc | null> {
    return this.col.findOneAndUpdate(
      { _id: userId },
      { $set: { [`oauth.${provider}`]: sub, ...(avatarUrl ? { avatarUrl } : {}) } },
      { returnDocument: 'after' },
    );
  }

  /**
   * Ban an account (dashboard moderation). Also bumps tokenVersion — not verified on
   * requests today, but free future-proofing if per-request checks are ever added.
   * Session revocation is the caller's job (DashboardUsersService).
   */
  setDisabled(userId: string, by: string, reason?: string): Promise<UserDoc | null> {
    return this.col.findOneAndUpdate(
      { _id: userId },
      {
        $set: {
          disabledAt: new Date(),
          disabledBy: by,
          ...(reason ? { disabledReason: reason } : {}),
        },
        $inc: { tokenVersion: 1 },
      },
      { returnDocument: 'after' },
    );
  }

  clearDisabled(userId: string): Promise<UserDoc | null> {
    return this.col.findOneAndUpdate(
      { _id: userId },
      { $unset: { disabledAt: '', disabledBy: '', disabledReason: '' } },
      { returnDocument: 'after' },
    );
  }

  /**
   * Hard-delete an account (dashboard `users.delete`). Session revocation and owned-map
   * cleanup are the caller's job; `matchHistory` is intentionally retained as the
   * anonymised archive — same posture as a TTL-expired guest.
   */
  async deleteById(userId: string): Promise<boolean> {
    const res = await this.col.deleteOne({ _id: userId });
    return res.deletedCount === 1;
  }

  /** Per-request feature check (projection-only point read). Used by FeatureGuard + inline gates. */
  async hasFeature(userId: string, feature: UserFeature): Promise<boolean> {
    const doc = await this.col.findOne({ _id: userId }, { projection: { features: 1 } });
    return !!doc?.features?.includes(feature);
  }

  /** Replace the feature set (dashboard). Guests can never hold features — the filter refuses them. */
  setFeatures(userId: string, features: UserFeature[]): Promise<UserDoc | null> {
    return this.col.findOneAndUpdate(
      { _id: userId, isGuest: false },
      features.length ? { $set: { features } } : { $unset: { features: '' } },
      { returnDocument: 'after' },
    );
  }

  /** Set/clear the tutorial-completed flag — self-service completion (`true`), or a dashboard
   *  reset (`false`). Available to guests too (no `isGuest` filter, unlike `setFeatures`). */
  setTutorialCompleted(userId: string, value: boolean): Promise<UserDoc | null> {
    return this.col.findOneAndUpdate(
      { _id: userId },
      { $set: { tutorialCompleted: value } },
      { returnDocument: 'after' },
    );
  }

  /** Accounts holding at least one feature, newest first (dashboard Features view). */
  listFeatured(): Promise<UserDoc[]> {
    return this.col
      .find({ features: { $exists: true, $ne: [] } })
      .sort({ createdAt: -1 })
      .toArray();
  }

  /**
   * Dashboard listing: newest first with a (createdAt, _id) composite cursor for stable
   * pagination. `filter` narrows by account kind; `disabled` matches banned accounts.
   */
  listPage(
    filter: 'all' | 'guests' | 'registered' | 'disabled',
    limit: number,
    cursor: { t: Date; id: string } | null,
  ): Promise<UserDoc[]> {
    const kind =
      filter === 'guests'
        ? { isGuest: true }
        : filter === 'registered'
          ? { isGuest: false }
          : filter === 'disabled'
            ? { disabledAt: { $exists: true } }
            : {};
    const page = cursor
      ? {
          $or: [{ createdAt: { $lt: cursor.t } }, { createdAt: cursor.t, _id: { $lt: cursor.id } }],
        }
      : {};
    return this.col
      .find({ ...kind, ...page })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Dashboard search: exact id, or case-insensitive PREFIX match on email/displayName.
   * The query is regex-escaped (unescaped user input = ReDoS / filter bypass). The
   * anchored email prefix rides the email index; displayName is a bounded scan —
   * acceptable at this product's scale.
   */
  search(q: string, limit: number): Promise<UserDoc[]> {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefix = new RegExp(`^${escaped}`, 'i');
    return this.col
      .find({ $or: [{ _id: q }, { email: prefix }, { displayName: prefix }] })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  /** Create a passwordless registered user from a verified OAuth profile. */
  async createOauthUser(
    email: string,
    displayName: string,
    provider: OauthProvider,
    sub: string,
    locale: Locale,
    avatarUrl: string | null,
  ): Promise<UserDoc> {
    const doc: UserDoc = {
      _id: randomUUID(),
      displayName,
      isGuest: false,
      preferences: { ...DEFAULT_PREFERENCES, locale },
      email: email.toLowerCase(),
      oauth: { [provider]: sub },
      ...(avatarUrl ? { avatarUrl } : {}),
      tokenVersion: 0,
      createdAt: new Date(),
    };
    await this.col.insertOne(doc);
    return doc;
  }
}
