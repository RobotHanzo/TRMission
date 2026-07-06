# Account Deletion (P0-c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `DELETE /api/v1/auth/me` — in-app account deletion (Apple 5.1.1(v) + Google Play requirement) with cascade cleanup and best-effort Sign in with Apple token revocation.

**Architecture:** A new `src/account/` module (imports Auth/Lobby/History/Maps/Dashboard modules — no cycles, since nothing imports it) hosts `AccountDeletionService` + a second `api/v1/auth`-prefixed controller. Cascade follows the codebase's established dangling-id posture (guest TTL deletion already leaves opaque ids everywhere and every read path tolerates it): **delete** the user doc, auth sessions, LOBBY room seats (via `RoomRepo.leave`, which handles host transfer/close), custom-map drafts, and matchHistory spectator entries; **leave intact** the event-sourced game log (`games`/`gameEvents`/`gameSnapshots`/`gameChats` — rewriting playerIds breaks `stateDigest` replay), `mapContents` (immutable, load-bearing for replays), `dashboardAudit` (append-only by pinned spec, denormalized precisely for this case), and STARTED rooms (no removal path by design). Apple revocation follows TN3194: the client re-authenticates for a fresh `authorizationCode`, the server exchanges it (`/auth/token`, ES256 client-secret JWT) and revokes (`/auth/revoke`) — best-effort, deletion proceeds on failure per TN3194's documented fallback.

**Tech Stack:** NestJS + nestjs-zod, `jose` (already a dep from P0-b: `SignJWT` + `importPKCS8` for the ES256 client secret), global `fetch`, vitest/supertest harness.

## Global Constraints

- swc not tsx; tests via `yarn workspace @trm/server test --run <substring>`; zod single-source; injectable-config/fake-seam test pattern; never `git add -A`.
- Maintainer guard returns **409 ConflictException** (`accounts.findById(userId)` truthy → refuse), mirroring the ban flow's existing precedent at `dashboard-users.service.ts:96-98` — not 403.
- Revocation client id = `env.appleClientIds[0]` (single-app v1); client secret is ES256 (`kid` header = `APPLE_KEY_ID`, `iss` = `APPLE_TEAM_ID`, `sub` = client id, `aud` = `https://appleid.apple.com`, short expiry — max allowed is 6 months).
- Native-flow authorization codes are exchanged **without** `redirect_uri` (web-flow-only parameter per TN3194).
- Deliberately NOT done: `mobileAuthCodes` cleanup (≤10-min TTL self-cleans), `games.spectators` $pull (transient, LIVE-only, dangling-tolerated), dashboard audit entry (no dashboard actor; AuditService not exported), the public web deletion URL page (tracked in `docs/TODO.md`, needed at store-listing time P6).
- `apps/server/test/auth.e2e.spec.ts` must keep passing untouched.

---

### Task 1: `DELETE /auth/me` — cascade + Apple revocation

**Files:**
- Create: `apps/server/src/account/apple-token-revoker.ts`
- Create: `apps/server/src/account/account-deletion.service.ts`
- Create: `apps/server/src/account/account.controller.ts`
- Create: `apps/server/src/account/account.module.ts`
- Create: `apps/server/test/account-delete.e2e.spec.ts`
- Modify: `apps/server/src/config/env.ts` (Apple revocation credentials)
- Modify: `apps/server/src/auth/auth.controller.ts` (export the two cookie constants)
- Modify: `apps/server/src/auth/auth.schemas.ts` (`DeleteAccountSchema`/Dto)
- Modify: `apps/server/src/auth/user.repo.ts` (`deleteById`)
- Modify: `apps/server/src/auth/session.repo.ts` (`deleteAllForUser`)
- Modify: `apps/server/src/history/history.repo.ts` (`pullSpectator`)
- Modify: `apps/server/src/maps/custom-map.repo.ts` (`removeAllByOwner`)
- Modify: `apps/server/src/dashboard/dashboard.module.ts` (`exports: [DashboardAccountRepo]`)
- Modify: `apps/server/src/app.module.ts` (register `AccountModule`)
- Modify: `apps/server/test/app.ts` (`FakeAppleTokenRevoker` + `appleRevoker` option)

**Interfaces:**
- Consumes: `RoomRepo.findActiveByMember(userId)/leave(code, userId)`, `DashboardAccountRepo.findById(userId)`, `SessionRepo`, `UserRepo`, P0-a/b auth transports, `AuthUser` from `@CurrentUser()`.
- Produces:
  - `interface AppleTokenRevoker { revoke(authorizationCode: string): Promise<boolean> }` (never throws; false = unconfigured/failed), symbol `APPLE_TOKEN_REVOKER`, `FetchAppleTokenRevoker` (jose client secret + `fetch` to `appleid.apple.com`).
  - `AccountDeletionService.deleteAccount(user: AuthUser, appleAuthorizationCode?: string): Promise<void>`.
  - `DELETE /api/v1/auth/me` (Bearer; optional body `{ appleAuthorizationCode }`) → 204, clears the web refresh cookie.
  - Repo additions: `UserRepo.deleteById(id): Promise<void>`, `SessionRepo.deleteAllForUser(userId): Promise<void>`, `HistoryRepo.pullSpectator(userId): Promise<void>`, `CustomMapRepo.removeAllByOwner(ownerId): Promise<number>`.
  - Env: `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (PKCS8 PEM, `\n`-escaped newlines allowed).

- [ ] **Step 1: Write the failing e2e spec** (`apps/server/test/account-delete.e2e.spec.ts`)

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createTestApp, refreshCookie, FakeAppleTokenRevoker, type TestApp } from './app';

let sharedMongod: MongoMemoryServer;
beforeAll(async () => {
  sharedMongod = await MongoMemoryServer.create();
}, 60_000);
afterAll(() => sharedMongod.stop());

let t: TestApp;
let revoker: FakeAppleTokenRevoker;
const server = () => t.app.getHttpServer();

beforeAll(async () => {
  revoker = new FakeAppleTokenRevoker();
  t = await createTestApp({ mongod: sharedMongod, dbName: 'trm-test-delete', appleRevoker: revoker });
}, 60_000);
afterAll(() => t.close());

const register = async (email: string, name: string) => {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName: name })
    .expect(201);
  return res;
};

describe('DELETE /auth/me: basic deletion', () => {
  it('deletes a registered account: login, refresh, and /me all die', async () => {
    const reg = await register('gone@example.com', 'Goner');
    const cookie = refreshCookie(reg);
    await request(server())
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(204);

    await request(server())
      .post('/api/v1/auth/login')
      .send({ email: 'gone@example.com', password: 'password123' })
      .expect(401);
    await request(server()).post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
    await request(server())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(401); // token cryptographically valid ≤15min, but the user doc is gone
    expect(await t.db.collection('users').countDocuments({ _id: reg.body.user.id as never })).toBe(0);
    expect(await t.db.collection('authSessions').countDocuments({ userId: reg.body.user.id })).toBe(0);
  });

  it('deletes a mobile guest via the body-token transport', async () => {
    const guest = await request(server())
      .post('/api/v1/auth/guest')
      .set('x-trm-client', 'mobile')
      .send({})
      .expect(201);
    await request(server())
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${guest.body.accessToken}`)
      .expect(204);
    await request(server())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: guest.body.refreshToken })
      .expect(401);
  });
});

describe('DELETE /auth/me: cascade', () => {
  it('leaves LOBBY rooms, pulls history spectatorship, deletes map drafts', async () => {
    const reg = await register('cascade@example.com', 'Cascade');
    const uid = reg.body.user.id as string;
    const now = new Date();
    await t.db.collection('rooms').insertOne({
      _id: 'DELRM1' as never,
      hostId: uid,
      status: 'LOBBY',
      members: [{ userId: uid, displayName: 'Cascade', isGuest: false, seat: 0, ready: false }],
      maxPlayers: 5,
      settings: {},
      createdAt: now,
      updatedAt: now,
    } as never);
    await t.db.collection('matchHistory').insertOne({
      _id: 'delgame1' as never,
      players: [{ userId: 'someone-else', seat: 0 }],
      turnOrder: ['someone-else'],
      seed: 'seed',
      contentHash: 'hash',
      finalScores: { players: [], ranking: [] },
      winners: [],
      spectators: [uid],
      completedAt: now,
    } as never);
    await t.db.collection('customMaps').insertOne({
      _id: 'delmap1' as never,
      ownerId: uid,
      nameZh: '刪',
      nameEn: 'Del',
      revision: 1,
      draft: {},
      createdAt: now,
      updatedAt: now,
    } as never);

    await request(server())
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(204);

    const room = await t.db.collection('rooms').findOne({ _id: 'DELRM1' as never });
    expect(room?.status).toBe('CLOSED'); // sole member left → RoomRepo.leave closes the room
    expect(room?.members).toEqual([]);
    const hist = await t.db.collection('matchHistory').findOne({ _id: 'delgame1' as never });
    expect(hist?.spectators).toEqual([]);
    expect(await t.db.collection('customMaps').countDocuments({ ownerId: uid })).toBe(0);
  });

  it('refuses to delete a maintainer with 409 until access is revoked', async () => {
    const reg = await register('maint@example.com', 'Maint');
    await t.db.collection('dashboardAccounts').insertOne({
      _id: reg.body.user.id as never,
      role: 'owner',
      grantedBy: 'system',
      grantedAt: new Date(),
      updatedAt: new Date(),
    } as never);
    await request(server())
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(409);
    expect(
      await t.db.collection('users').countDocuments({ _id: reg.body.user.id as never }),
    ).toBe(1);
  });
});

describe('DELETE /auth/me: Apple token revocation', () => {
  it('revokes when the account has an apple identity and a code is supplied', async () => {
    const reg = await register('apple-del@example.com', 'AppleDel');
    await t.db
      .collection('users')
      .updateOne({ _id: reg.body.user.id as never }, { $set: { oauth: { apple: 'sub-1' } } });
    revoker.calls = [];
    await request(server())
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ appleAuthorizationCode: 'ac-1' })
      .expect(204);
    expect(revoker.calls).toEqual(['ac-1']);
  });

  it('does not call the revoker without an apple identity', async () => {
    const reg = await register('no-apple@example.com', 'NoApple');
    revoker.calls = [];
    await request(server())
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ appleAuthorizationCode: 'ac-2' })
      .expect(204);
    expect(revoker.calls).toEqual([]);
  });

  it('deletion proceeds even when revocation fails', async () => {
    const reg = await register('apple-fail@example.com', 'AppleFail');
    await t.db
      .collection('users')
      .updateOne({ _id: reg.body.user.id as never }, { $set: { oauth: { apple: 'sub-2' } } });
    revoker.result = false;
    await request(server())
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ appleAuthorizationCode: 'ac-3' })
      .expect(204);
    revoker.result = true;
    expect(
      await t.db.collection('users').countDocuments({ _id: reg.body.user.id as never }),
    ).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/server test --run account-delete`
Expected: FAIL — `FakeAppleTokenRevoker` not exported from `./app` (compile error).

- [ ] **Step 3: Env + repo cascade methods + cookie-constant exports**

`apps/server/src/config/env.ts` after `appleClientIds`:

```ts
  /** Sign in with Apple token revocation (account deletion). All three + a client id required. */
  appleTeamId: process.env.APPLE_TEAM_ID ?? '',
  appleKeyId: process.env.APPLE_KEY_ID ?? '',
  applePrivateKey: (process.env.APPLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
```

`apps/server/src/auth/auth.controller.ts` — export the constants (values unchanged):

```ts
export const REFRESH_COOKIE = 'trm_refresh';
export const REFRESH_PATH = '/api/v1/auth';
```

`apps/server/src/auth/user.repo.ts` (after `extendGuestExpiry`):

```ts
  /** Hard-delete an account doc (account deletion). Cascade is AccountDeletionService's job. */
  async deleteById(id: string): Promise<void> {
    await this.col.deleteOne({ _id: id });
  }
```

`apps/server/src/auth/session.repo.ts` (after `revokeAllForUser`):

```ts
  /** Account deletion: hard-delete every refresh family (revocation is not enough — PII purge). */
  async deleteAllForUser(userId: string): Promise<void> {
    await this.col.deleteMany({ userId });
  }
```

`apps/server/src/history/history.repo.ts` (near `setVisibility`):

```ts
  /** Account deletion: remove the user's spectator references (player rows keep opaque ids). */
  async pullSpectator(userId: string): Promise<void> {
    await this.col.updateMany({ spectators: userId }, { $pull: { spectators: userId } });
  }
```

(Adjust `this.col` to the actual matchHistory collection field name in that file.)

`apps/server/src/maps/custom-map.repo.ts` (after `removeAny`):

```ts
  /** Account deletion: drop every draft the user owns (published mapContents stay immutable). */
  async removeAllByOwner(ownerId: string): Promise<number> {
    const res = await this.col.deleteMany({ ownerId });
    return res.deletedCount;
  }
```

`apps/server/src/dashboard/dashboard.module.ts`: add `exports: [DashboardAccountRepo],` to the `@Module({...})`.

- [ ] **Step 4: Apple revoker seam** (`apps/server/src/account/apple-token-revoker.ts`)

```ts
import { Injectable, Logger } from '@nestjs/common';
import { SignJWT, importPKCS8 } from 'jose';
import { env } from '../config/env';

/**
 * Best-effort Sign in with Apple token revocation for account deletion (TN3194):
 * exchange the fresh authorizationCode the client re-authenticated for, then revoke
 * the resulting refresh token. Never throws — deletion must proceed regardless.
 */
export interface AppleTokenRevoker {
  /** true = revoked; false = not configured, exchange failed, or revoke failed. */
  revoke(authorizationCode: string): Promise<boolean>;
}

export const APPLE_TOKEN_REVOKER = Symbol('APPLE_TOKEN_REVOKER');

const APPLE_BASE = 'https://appleid.apple.com';

@Injectable()
export class FetchAppleTokenRevoker implements AppleTokenRevoker {
  private readonly log = new Logger('AppleTokenRevoker');

  private get clientId(): string {
    return env.appleClientIds[0] ?? '';
  }

  private get configured(): boolean {
    return !!(env.appleTeamId && env.appleKeyId && env.applePrivateKey && this.clientId);
  }

  /** ES256 client secret: kid header = key id; iss = team id; sub = client id (case-sensitive). */
  private async clientSecret(): Promise<string> {
    const key = await importPKCS8(env.applePrivateKey, 'ES256');
    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: env.appleKeyId })
      .setIssuer(env.appleTeamId)
      .setSubject(this.clientId)
      .setAudience(APPLE_BASE)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(key);
  }

  async revoke(authorizationCode: string): Promise<boolean> {
    if (!this.configured) return false;
    try {
      const secret = await this.clientSecret();
      // Native-flow codes are exchanged WITHOUT redirect_uri (web-flow-only parameter).
      const exchange = await fetch(`${APPLE_BASE}/auth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: authorizationCode,
          client_id: this.clientId,
          client_secret: secret,
        }),
      });
      if (!exchange.ok) {
        this.log.warn(`apple token exchange failed: ${exchange.status}`);
        return false;
      }
      const tokens = (await exchange.json()) as { refresh_token?: string };
      if (!tokens.refresh_token) return false;
      const revoke = await fetch(`${APPLE_BASE}/auth/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: secret,
          token: tokens.refresh_token,
          token_type_hint: 'refresh_token',
        }),
      });
      if (!revoke.ok) this.log.warn(`apple revoke failed: ${revoke.status}`);
      return revoke.ok;
    } catch (e) {
      this.log.warn(`apple revocation error: ${(e as Error).message}`);
      return false;
    }
  }
}
```

- [ ] **Step 5: Service, controller, module, schema, wiring**

`apps/server/src/auth/auth.schemas.ts`:

```ts
export const DeleteAccountSchema = z.object({
  /** Apple 5.1.1(v)/TN3194: a fresh SIWA authorizationCode so the server can revoke tokens. */
  appleAuthorizationCode: z.string().min(1).optional(),
});
export class DeleteAccountDto extends createZodDto(DeleteAccountSchema.default({})) {}
```

`apps/server/src/account/account-deletion.service.ts`:

```ts
import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserRepo } from '../auth/user.repo';
import { SessionRepo } from '../auth/session.repo';
import { RoomRepo } from '../lobby/room.repo';
import { HistoryRepo } from '../history/history.repo';
import { CustomMapRepo } from '../maps/custom-map.repo';
import { DashboardAccountRepo } from '../dashboard/dashboard-account.repo';
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
    await this.customMaps.removeAllByOwner(user.userId);
    await this.sessions.deleteAllForUser(user.userId);
    await this.users.deleteById(user.userId);
  }
}
```

`apps/server/src/account/account.controller.ts`:

```ts
import { Body, Controller, Delete, HttpCode, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { REFRESH_COOKIE, REFRESH_PATH } from '../auth/auth.controller';
import { DeleteAccountDto, DeleteAccountSchema } from '../auth/auth.schemas';
import { apiSchema } from '../openapi/openapi';
import { AccountDeletionService } from './account-deletion.service';
import type { AuthUser } from '../auth/auth.types';

@ApiTags('auth')
@Controller('api/v1/auth')
export class AccountController {
  constructor(private readonly deletion: AccountDeletionService) {}

  @Delete('me')
  @HttpCode(204)
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Delete the current account (irreversible; revokes Apple tokens)' })
  @ApiBody({ schema: apiSchema(DeleteAccountSchema) })
  async deleteMe(
    @CurrentUser() user: AuthUser,
    @Body() body: DeleteAccountDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.deletion.deleteAccount(user, body.appleAuthorizationCode);
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
  }
}
```

`apps/server/src/account/account.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LobbyModule } from '../lobby/lobby.module';
import { HistoryModule } from '../history/history.module';
import { MapsModule } from '../maps/maps.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { AccountController } from './account.controller';
import { AccountDeletionService } from './account-deletion.service';
import { APPLE_TOKEN_REVOKER, FetchAppleTokenRevoker } from './apple-token-revoker';

// Self-service account lifecycle. Separate module so it can import every domain it must
// cascade into without creating cycles (nothing imports AccountModule).
@Module({
  imports: [AuthModule, LobbyModule, HistoryModule, MapsModule, DashboardModule],
  controllers: [AccountController],
  providers: [
    AccountDeletionService,
    { provide: APPLE_TOKEN_REVOKER, useClass: FetchAppleTokenRevoker },
  ],
})
export class AccountModule {}
```

`apps/server/src/app.module.ts`: import + add `AccountModule` to `imports` (after `DashboardModule`).

`apps/server/test/app.ts`: import the seam, add option + override + fake:

```ts
import { APPLE_TOKEN_REVOKER, type AppleTokenRevoker } from '../src/account/apple-token-revoker';
```

```ts
  /** Stub Apple token revocation (account deletion). */
  appleRevoker?: AppleTokenRevoker;
```

```ts
  if (opts.appleRevoker)
    builder = builder.overrideProvider(APPLE_TOKEN_REVOKER).useValue(opts.appleRevoker);
```

```ts
/** A controllable stand-in for Apple token revocation. */
export class FakeAppleTokenRevoker implements AppleTokenRevoker {
  calls: string[] = [];
  result = true;
  async revoke(code: string): Promise<boolean> {
    this.calls.push(code);
    return this.result;
  }
}
```

- [ ] **Step 6: Run the spec + regressions**

Run: `yarn workspace @trm/server test --run account-delete`
Expected: PASS (7 tests)
Run: `yarn workspace @trm/server test --run auth.e2e`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/account apps/server/src/config/env.ts apps/server/src/auth/auth.controller.ts apps/server/src/auth/auth.schemas.ts apps/server/src/auth/user.repo.ts apps/server/src/auth/session.repo.ts apps/server/src/history/history.repo.ts apps/server/src/maps/custom-map.repo.ts apps/server/src/dashboard/dashboard.module.ts apps/server/src/app.module.ts apps/server/test/app.ts apps/server/test/account-delete.e2e.spec.ts
git commit -m "feat(server): in-app account deletion with Apple token revocation"
```

---

### Task 2: Full-suite regression + docs

**Files:**
- Modify: `CLAUDE.md`, `apps/server/CLAUDE.md`, `docs/TODO.md`

- [ ] **Step 1: Gates**

Run: `yarn workspace @trm/server test` → all PASS; `yarn typecheck` → clean; `yarn lint` → clean.

- [ ] **Step 2: Docs**

Root `CLAUDE.md` mobile paragraph — append after the `APPLE_CLIENT_IDS` clause:

```markdown
`APPLE_TEAM_ID` + `APPLE_KEY_ID` + `APPLE_PRIVATE_KEY` (SIWA token revocation during
`DELETE /auth/me` account deletion; revocation is best-effort per TN3194),
```

`apps/server/CLAUDE.md` — append to the Mobile transport block:

```markdown
  **Account deletion**: `DELETE /auth/me` (Bearer; optional `{appleAuthorizationCode}` from a
  fresh SIWA re-auth for token revocation, best-effort). Cascade in `src/account/`: deletes
  users/authSessions/customMaps drafts, leaves LOBBY rooms via `RoomRepo.leave`, `$pull`s
  matchHistory spectators; the event-sourced game log, `mapContents`, and `dashboardAudit`
  stay (dangling opaque ids = the same posture as guest TTL expiry). Maintainers get 409
  until dashboard access is revoked.
```

`docs/TODO.md` — add under "Mobile — deferred from v1":

```markdown
- **Public web account-deletion page** — Google Play's Data-safety form requires an HTTPS
  URL usable without the app; the server endpoint exists (`DELETE /auth/me`), the web page
  does not. Needed before store listing (P6).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md apps/server/CLAUDE.md docs/TODO.md
git commit -m "docs: document account deletion + Apple revocation env"
```
