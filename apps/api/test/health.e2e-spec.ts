import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers.js';

describe('GET /health', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp({ testAuth: false });
  });
  afterAll(async () => {
    await app.close();
  });

  it('reports service status, database status and a timestamp', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'dumpwise-api', checks: { database: 'up' } });
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });

  it('returns the standard error shape for unknown routes', async () => {
    const res = await request(app.getHttpServer()).get('/does-not-exist').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, path: '/does-not-exist' });
    expect(res.body.timestamp).toBeDefined();
  });
});
