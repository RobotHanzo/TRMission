import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { UserRepo, toPublicUser, type UserDoc } from './user.repo';
import { FeatureDefaultsRepo } from './feature-defaults.repo';
import { SessionRepo } from './session.repo';
import { TokenService } from './token.service';
import type { IssuedAuth, Locale, PublicUser, UserPreferences } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserRepo,
    private readonly sessions: SessionRepo,
    private readonly tokens: TokenService,
    private readonly defaults: FeatureDefaultsRepo,
  ) {}

  /** `toPublicUser` unioned with the global default feature set (Task 2) — the single place
   *  `PublicUser.features` is assembled, so every entry point below stays in sync. */
  private async withDefaults(user: UserDoc): Promise<PublicUser> {
    const pub = toPublicUser(user);
    const defaults = await this.defaults.get();
    return { ...pub, features: [...new Set([...pub.features, ...defaults])] };
  }

  private async issue(user: UserDoc): Promise<IssuedAuth> {
    // The single session-mint chokepoint (guest/register/login/upgrade/OAuth): a banned
    // account can never obtain a new session through any entry method.
    if (user.disabledAt) throw new ForbiddenException('account disabled');
    const refreshToken = await this.sessions.create(user._id);
    return {
      user: await this.withDefaults(user),
      accessToken: this.tokens.signAccess(user),
      refreshToken,
    };
  }

  /** Mint a fresh session for an already-resolved user (used by the OAuth flow). */
  issueFor(user: UserDoc): Promise<IssuedAuth> {
    return this.issue(user);
  }

  async guest(displayName: string, locale: Locale): Promise<IssuedAuth> {
    return this.issue(await this.users.createGuest(displayName, locale));
  }

  async register(
    email: string,
    password: string,
    displayName: string,
    locale: Locale,
  ): Promise<IssuedAuth> {
    if (await this.users.findByEmail(email))
      throw new ConflictException('email already registered');
    return this.issue(
      await this.users.createRegistered(email, await hash(password), displayName, locale),
    );
  }

  /** Attach credentials to the currently-authenticated guest, keeping its id (A9). */
  async upgrade(userId: string, email: string, password: string): Promise<IssuedAuth> {
    if (await this.users.findByEmail(email))
      throw new ConflictException('email already registered');
    const user = await this.users.upgradeGuest(userId, email, await hash(password));
    if (!user) throw new UnauthorizedException('not a guest account');
    // Prior guest refresh families die with the upgrade; the fresh one is minted just below.
    await this.sessions.revokeAllForUser(user._id);
    return this.issue(user);
  }

  async login(email: string, password: string): Promise<IssuedAuth> {
    const user = await this.users.findByEmail(email);
    if (!user?.passwordHash || !(await verify(user.passwordHash, password))) {
      throw new UnauthorizedException('invalid credentials');
    }
    return this.issue(user);
  }

  async refresh(
    refreshToken: string | undefined,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    if (!refreshToken) throw new UnauthorizedException('no refresh token');
    const outcome = await this.sessions.rotate(refreshToken);
    if (outcome.kind !== 'ok') {
      throw new UnauthorizedException(
        outcome.kind === 'reuse' ? 'refresh token reuse detected' : 'invalid refresh token',
      );
    }
    const user = await this.users.findById(outcome.userId);
    if (!user) throw new UnauthorizedException('user not found');
    // Belt-and-braces on top of ban-time revokeAllForUser: a family minted in a race
    // with the ban still can't be rotated into a fresh access token.
    if (user.disabledAt) throw new UnauthorizedException('account disabled');
    return { accessToken: this.tokens.signAccess(user), refreshToken: outcome.token };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) await this.sessions.revoke(refreshToken);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('user not found');
    return this.withDefaults(user);
  }

  async updatePreferences(userId: string, preferences: UserPreferences): Promise<PublicUser> {
    const user = await this.users.updatePreferences(userId, preferences);
    if (!user) throw new UnauthorizedException('user not found');
    return this.withDefaults(user);
  }

  async completeTutorial(userId: string): Promise<PublicUser> {
    const user = await this.users.setTutorialCompleted(userId, true);
    if (!user) throw new UnauthorizedException('user not found');
    return this.withDefaults(user);
  }
}
