import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

// The other e2e files run with a high auth limit so they can log in freely. This file sets a
// LOW limit before the application module is loaded (each test file has its own module
// registry), then proves the limiter actually fires.
describe('rate limiting on credential endpoints', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env['RATE_LIMIT_AUTH_PER_MINUTE'] = '3';
    const { createTestApp } = await import('./helpers.js');
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('returns 429 after 3 login attempts per minute, but other endpoints keep working', async () => {
    const attempt = () => request(app.getHttpServer()).post('/v1/auth/login').send({ email: 'x@example.invalid', password: 'guess' });
    for (let i = 0; i < 3; i++) await attempt().expect(401);
    const limited = await attempt().expect(429);
    expect(limited.body.statusCode).toBe(429);
    expect(limited.headers['retry-after-auth']).toBeDefined();
    await request(app.getHttpServer()).get('/health').expect(200);
  });
});
