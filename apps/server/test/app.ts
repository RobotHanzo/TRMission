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
}

export async function createTestApp(opts: TestAppOptions = {}): Promise<TestApp> {
  const mongod = await MongoMemoryServer.create();
  const client = new MongoClient(mongod.getUri());
  await client.connect();
  const db = client.db('trm-test');

  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MONGO_DB)
    .useValue(db);
  if (opts.authConfig) builder = builder.overrideProvider(AuthConfig).useValue(new AuthConfig(opts.authConfig));
  if (opts.oauthHttp) builder = builder.overrideProvider(OAUTH_HTTP).useValue(opts.oauthHttp);

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
      await mongod.stop();
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
