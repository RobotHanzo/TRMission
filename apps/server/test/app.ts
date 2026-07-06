// Boots the full REST app against an in-memory MongoDB (overriding the real MONGO_DB
// provider), with the same middleware/pipes as production. Used by the HTTP e2e specs.
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { MONGO_DB } from '../src/db/tokens';
import { OpenApiHolder } from '../src/openapi/openapi.holder';
import { buildOpenApiDocument } from '../src/openapi/openapi';
import { AuthConfig, type AuthConfigOverrides } from '../src/auth/auth-config';
import { OAUTH_HTTP, type OauthHttp, type OauthProfile } from '../src/auth/oauth.http';
import {
  GOOGLE_ID_TOKEN_VERIFIER,
  type GoogleIdTokenVerifier,
} from '../src/auth/google-id-token.verifier';
import { DashboardConfig, type DashboardConfigOverrides } from '../src/dashboard/dashboard-config';
import {
  MobileLinksConfig,
  type MobileLinksConfigOverrides,
} from '../src/config/mobile-links.config';

export interface TestApp {
  app: INestApplication;
  db: Db;
  close(): Promise<void>;
}

export interface TestAppOptions {
  /** Override AuthConfig (enable providers, flip password/guest toggles) without touching env. */
  authConfig?: AuthConfigOverrides;
  /** Stub the network seam so OAuth e2e never leaves the process. */
  oauthHttp?: OauthHttp;
  /** Stub Google ID-token verification (One Tap / rendered-button credential flow). */
  googleVerifier?: GoogleIdTokenVerifier;
  /** Override DashboardConfig (owner-email bootstrap) without touching env. */
  dashboardConfig?: DashboardConfigOverrides;
  /** Override MobileLinksConfig (deep-link verification files) without touching env. */
  mobileLinks?: MobileLinksConfigOverrides;
  /**
   * Reuse an already-running MongoMemoryServer instead of spawning a new `mongod` process.
   * Specs that boot several TestApps (e.g. one per auth-config variant) should share one —
   * each spawn is a real child process, and doing that repeatedly in a single file is the
   * heaviest thing in the e2e suite under CI contention. Pair with `dbName` for isolation.
   */
  mongod?: MongoMemoryServer;
  /** Logical database name to use on a shared `mongod` (default: 'trm-test'). */
  dbName?: string;
}

export async function createTestApp(opts: TestAppOptions = {}): Promise<TestApp> {
  const ownsMongod = !opts.mongod;
  const mongod = opts.mongod ?? (await MongoMemoryServer.create());
  const client = new MongoClient(mongod.getUri());
  await client.connect();
  const db = client.db(opts.dbName ?? 'trm-test');

  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MONGO_DB)
    .useValue(db);
  if (opts.authConfig)
    builder = builder.overrideProvider(AuthConfig).useValue(new AuthConfig(opts.authConfig));
  if (opts.oauthHttp) builder = builder.overrideProvider(OAUTH_HTTP).useValue(opts.oauthHttp);
  if (opts.googleVerifier)
    builder = builder.overrideProvider(GOOGLE_ID_TOKEN_VERIFIER).useValue(opts.googleVerifier);
  if (opts.dashboardConfig)
    builder = builder
      .overrideProvider(DashboardConfig)
      .useValue(new DashboardConfig(opts.dashboardConfig));
  if (opts.mobileLinks)
    builder = builder
      .overrideProvider(MobileLinksConfig)
      .useValue(new MobileLinksConfig(opts.mobileLinks));

  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  await app.init();
  app.get(OpenApiHolder).set(buildOpenApiDocument(app));

  return {
    app,
    db,
    async close() {
      await app.close();
      await client.close();
      if (ownsMongod) await mongod.stop();
    },
  };
}

/** A controllable stand-in for the provider network call: set `profile`, or `fail` to throw. */
export class FakeOauthHttp implements OauthHttp {
  profile: OauthProfile | null = null;
  fail = false;
  async getProfile(): Promise<OauthProfile> {
    if (this.fail || !this.profile) throw new Error('fake oauth exchange failed');
    return this.profile;
  }
}

/** A controllable stand-in for Google ID-token verification: set `profile`, or `fail` to throw. */
export class FakeGoogleIdTokenVerifier implements GoogleIdTokenVerifier {
  profile: OauthProfile | null = null;
  fail = false;
  lastAudience: string | string[] | null = null;
  async verify(_idToken: string, audience: string | string[]): Promise<OauthProfile> {
    this.lastAudience = audience;
    if (this.fail || !this.profile) throw new Error('fake google verify failed');
    return this.profile;
  }
}

/** Both providers enabled, on a fixed redirect base, for OAuth e2e. */
export const OAUTH_TEST_CONFIG: AuthConfigOverrides = {
  passwordLogin: true,
  guest: true,
  redirectBase: 'http://localhost:5173',
  providers: {
    google: { clientId: 'gid', clientSecret: 'gsec' },
    discord: { clientId: 'did', clientSecret: 'dsec' },
  },
};

/** Extract the `trm_refresh=...` cookie pair from a response's Set-Cookie header. */
export function refreshCookie(res: { headers: Record<string, unknown> }): string {
  const setCookie = res.headers['set-cookie'] as string[] | undefined;
  const c = setCookie?.find((s) => s.startsWith('trm_refresh='));
  return c ? (c.split(';')[0] ?? '') : '';
}
