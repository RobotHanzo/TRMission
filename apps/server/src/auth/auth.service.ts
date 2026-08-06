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
import type { MapFeatureKey } from '@trm/shared';
import type { IssuedAuth, Locale, PublicUser, UserPreferencesPatch } from './auth.types';

/** Fixed input for the login timing-oracle mitigation's dummy verification target — see
 *  `login` below. It's never a real password; any fixed string works. */
const DUMMY_PASSWORD_SEED = 'trm-login-timing-mitigation-dummy-password';

/** Memoized once computed (see `getDummyPasswordHash`). `AuthBootstrap` forces that first
 *  computation during server bootstrap — before the app accepts connections (see
 *  auth-bootstrap.ts) — so even the very first miss-path login after process start costs
 *  the same as every later one. */
let dummyPasswordHash: Promise<string> | undefined;

/** Argon2id hash of a fixed, never-real password. `login` verifies against this whenever
 *  there is no real `passwordHash` to check (unknown email, or an OAuth-only/passwordless
 *  account), so a miss pays the same argon2id cost as a hit and POST /auth/login stops being
 *  a timing oracle for account existence (CWE-208). */
function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHash ??= hash(DUMMY_PASSWORD_SEED);
  return dummyPasswordHash;
}

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

  private async issue(user: UserDoc, ip?: string): Promise<IssuedAuth> {
    // The single session-mint chokepoint (guest/register/login/upgrade/OAuth): a banned
    // account can never obtain a new session through any entry method.
    if (user.disabledAt) throw new ForbiddenException('account disabled');
    const refreshToken = await this.sessions.create(user._id);
    if (ip) await this.users.recordLogin(user._id, ip);
    return {
      user: await this.withDefaults(user),
      accessToken: this.tokens.signAccess(user),
      refreshToken,
    };
  }

  /** Mint a fresh session for an already-resolved user (used by the OAuth flow). */
  issueFor(user: UserDoc, ip?: string): Promise<IssuedAuth> {
    return this.issue(user, ip);
  }

  async guest(displayName: string, locale: Locale, ip?: string): Promise<IssuedAuth> {
    return this.issue(await this.users.createGuest(displayName, locale), ip);
  }

  async register(
    email: string,
    password: string,
    displayName: string,
    locale: Locale,
    ip?: string,
  ): Promise<IssuedAuth> {
    if (await this.users.findByEmail(email))
      throw new ConflictException('email already registered');
    return this.issue(
      await this.users.createRegistered(email, await hash(password), displayName, locale),
      ip,
    );
  }

  /** Attach credentials to the currently-authenticated guest, keeping its id (A9). */
  async upgrade(userId: string, email: string, password: string, ip?: string): Promise<IssuedAuth> {
    if (await this.users.findByEmail(email))
      throw new ConflictException('email already registered');
    const user = await this.users.upgradeGuest(userId, email, await hash(password));
    if (!user) throw new UnauthorizedException('not a guest account');
    // Prior guest refresh families die with the upgrade; the fresh one is minted just below.
    await this.sessions.revokeAllForUser(user._id);
    return this.issue(user, ip);
  }

  /** Forces the dummy password hash (see `getDummyPasswordHash` above) to be computed and
   *  memoized. Called once by `AuthBootstrap` during server bootstrap, before the app accepts
   *  connections — see auth-bootstrap.ts for why. */
  async warmDummyPasswordHash(): Promise<void> {
    await getDummyPasswordHash();
  }

  async login(email: string, password: string, ip?: string): Promise<IssuedAuth> {
    const user = await this.users.findByEmail(email);
    // Always run argon2 verification, even when there's no real hash to check (unknown
    // email, or a passwordless OAuth-only account): a miss must pay the same cost as a hit,
    // or POST /auth/login becomes a timing oracle for account existence (CWE-208).
    const verified = await verify(user?.passwordHash ?? (await getDummyPasswordHash()), password);
    if (!user?.passwordHash || !verified) {
      throw new UnauthorizedException('invalid credentials');
    }
    return this.issue(user, ip);
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
    if (user.isGuest) await this.users.extendGuestExpiry(user._id);
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

  async updatePreferences(userId: string, preferences: UserPreferencesPatch): Promise<PublicUser> {
    const user = await this.users.updatePreferences(userId, preferences);
    if (!user) throw new UnauthorizedException('user not found');
    return this.withDefaults(user);
  }

  async completeTutorial(userId: string): Promise<PublicUser> {
    const user = await this.users.setTutorialCompleted(userId, true);
    if (!user) throw new UnauthorizedException('user not found');
    return this.withDefaults(user);
  }

  async markFeatureIntroSeen(userId: string, feature: MapFeatureKey): Promise<PublicUser> {
    const user = await this.users.addSeenFeatureIntro(userId, feature);
    if (!user) throw new UnauthorizedException('user not found');
    return this.withDefaults(user);
  }
}
