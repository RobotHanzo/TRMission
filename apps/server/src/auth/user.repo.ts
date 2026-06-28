import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Collection, Db } from 'mongodb';
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
}

export const toPublicUser = (u: UserDoc): PublicUser => ({
  id: u._id,
  displayName: u.displayName,
  isGuest: u.isGuest,
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
