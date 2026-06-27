import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { UserRepo, toPublicUser, type UserDoc } from './user.repo';
import { SessionRepo } from './session.repo';
import { TokenService } from './token.service';
import type { IssuedAuth, Locale, PublicUser, UserPreferences } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserRepo,
    private readonly sessions: SessionRepo,
    private readonly tokens: TokenService,
  ) {}

  private async issue(user: UserDoc): Promise<IssuedAuth> {
    const refreshToken = await this.sessions.create(user._id);
    return { user: toPublicUser(user), accessToken: this.tokens.signAccess(user), refreshToken };
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
    return { accessToken: this.tokens.signAccess(user), refreshToken: outcome.token };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) await this.sessions.revoke(refreshToken);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('user not found');
    return toPublicUser(user);
  }

  async updatePreferences(userId: string, preferences: UserPreferences): Promise<PublicUser> {
    const user = await this.users.updatePreferences(userId, preferences);
    if (!user) throw new UnauthorizedException('user not found');
    return toPublicUser(user);
  }
}
