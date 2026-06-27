import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OpenApiHolder } from '../src/openapi/openapi.holder';
import { buildOpenApiDocument } from '../src/openapi/openapi';

let app: INestApplication;

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  app.get(OpenApiHolder).set(buildOpenApiDocument(app));
});

afterAll(async () => {
  await app.close();
});

describe('OpenAPI + Scalar docs', () => {
  it('serves a dynamically generated OpenAPI 3 document', async () => {
    const res = await request(app.getHttpServer()).get('/api/openapi.json').expect(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.info.title).toBe('TRMission API');
    expect(res.body.paths['/healthz']).toBeDefined();
    expect(res.body.paths['/version']).toBeDefined();
    // The bearer scheme is registered ahead of the protected auth/lobby routes.
    expect(res.body.components?.securitySchemes?.['access-token']?.scheme).toBe('bearer');
  });

  it('serves the Scalar reference UI at /docs', async () => {
    const res = await request(app.getHttpServer()).get('/docs').expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('id="api-reference"');
    expect(res.text).toContain('/api/openapi.json');
  });

  it('keeps the health + version endpoints working', async () => {
    await request(app.getHttpServer()).get('/healthz').expect(200, { status: 'ok' });
    const res = await request(app.getHttpServer()).get('/version').expect(200);
    expect(res.body.protocolVersion).toBe(1);
    expect(typeof res.body.contentHash).toBe('string');
  });
});
