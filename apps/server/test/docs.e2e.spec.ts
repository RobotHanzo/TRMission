import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { PROTOCOL_VERSION } from '@trm/proto';
import { createTestApp, type TestApp } from './app';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);

afterAll(() => t.close());

describe('OpenAPI + Scalar docs', () => {
  it('serves a dynamically generated OpenAPI 3 document covering the REST routes', async () => {
    const res = await request(t.app.getHttpServer()).get('/api/openapi.json').expect(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.info.title).toBe('TRMission API');
    expect(res.body.paths['/healthz']).toBeDefined();
    expect(res.body.paths['/api/v1/auth/guest']).toBeDefined();
    expect(res.body.paths['/api/v1/auth/me']).toBeDefined();
    expect(res.body.components?.securitySchemes?.['access-token']?.scheme).toBe('bearer');
  });

  it('serves the Scalar reference UI at /docs', async () => {
    const res = await request(t.app.getHttpServer()).get('/docs').expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('id="api-reference"');
    expect(res.text).toContain('/api/openapi.json');
  });

  it('keeps the health + version endpoints working', async () => {
    await request(t.app.getHttpServer()).get('/healthz').expect(200, { status: 'ok' });
    const res = await request(t.app.getHttpServer()).get('/version').expect(200);
    expect(res.body.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('exposes Prometheus metrics including the leak guard', async () => {
    const res = await request(t.app.getHttpServer()).get('/metrics').expect(200);
    expect(res.text).toContain('trm_security_leak_blocked_total');
    expect(res.text).toContain('trm_active_connections');
  });
});
