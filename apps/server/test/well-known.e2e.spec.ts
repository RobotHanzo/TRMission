import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createTestApp, type TestApp } from './app';

let sharedMongod: MongoMemoryServer;
beforeAll(async () => {
  sharedMongod = await MongoMemoryServer.create();
}, 60_000);
afterAll(() => sharedMongod.stop());

describe('/.well-known: unconfigured → 404', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ mongod: sharedMongod, dbName: 'trm-test-wk-off' });
  }, 60_000);
  afterAll(() => t.close());

  it('404s both files when no app ids are set', async () => {
    await request(t.app.getHttpServer()).get('/.well-known/apple-app-site-association').expect(404);
    await request(t.app.getHttpServer()).get('/.well-known/assetlinks.json').expect(404);
  });
});

describe('/.well-known: configured payloads', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({
      mongod: sharedMongod,
      dbName: 'trm-test-wk-on',
      mobileLinks: {
        appleAppId: 'ABCDE12345.dev.robothanzo.trmission',
        androidPackageName: 'dev.robothanzo.trmission',
        androidCertSha256: ['AA:BB:CC'],
      },
    });
  }, 60_000);
  afterAll(() => t.close());

  it('serves the AASA with the /m/callback pattern', async () => {
    const res = await request(t.app.getHttpServer())
      .get('/.well-known/apple-app-site-association')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    expect(res.body).toEqual({
      applinks: {
        details: [
          { appIDs: ['ABCDE12345.dev.robothanzo.trmission'], components: [{ '/': '/m/callback*' }] },
        ],
      },
    });
  });

  it('serves assetlinks.json with the package + fingerprints', async () => {
    const res = await request(t.app.getHttpServer())
      .get('/.well-known/assetlinks.json')
      .expect(200);
    expect(res.body).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'dev.robothanzo.trmission',
          sha256_cert_fingerprints: ['AA:BB:CC'],
        },
      },
    ]);
  });
});
