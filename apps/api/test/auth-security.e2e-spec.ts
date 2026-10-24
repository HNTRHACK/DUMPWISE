import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import { spawnSync } from 'node:child_process';
import { AuthService } from '../src/auth/auth.service.js';
import {
  LoginAbuseService,
  sourceHash,
} from '../src/auth/login-abuse.service.js';
import { AuditService } from '../src/audit/audit.service.js';
import { type Env, validateEnv } from '../src/config/env.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTenant,
  createTestApp,
  fixtureDb,
  TEST_PASSWORD,
} from './helpers.js';

describe('persistent authentication controls', () => {
  let app: INestApplication, fixture: PrismaService, runtime: PrismaService;
  let auth: AuthService, abuse: LoginAbuseService;
  beforeAll(async () => {
    app = await createTestApp();
    fixture = fixtureDb(app);
    runtime = app.get(PrismaService);
    const config = new ConfigService<Env, true>(
      validateEnv({
        DATABASE_URL: process.env['TEST_DATABASE_URL'],
        LOGIN_MAX_FAILURES_PER_ACCOUNT_IP: 3,
        LOGIN_MAX_FAILURES_PER_IP: 4,
        LOGIN_MAX_FAILURES_PER_ACCOUNT: 4,
        AUTH_MAX_SESSIONS_PER_USER: 2,
      }),
    );
    auth = new AuthService(runtime, config, app.get(AuditService));
    abuse = new LoginAbuseService(runtime, config);
  });
  afterAll(async () => {
    await app.close();
  });
  async function user() {
    const t = await createTenant(fixture);
    await auth.setPassword(t.ownerId, TEST_PASSWORD);
    return fixture.user.findUniqueOrThrow({ where: { id: t.ownerId } });
  }

  it('blocks concurrent pair failures persistently and counts unknown accounts without storing raw IP/email keys', async () => {
    const email = 'missing@example.invalid',
      ip = '192.0.2.10';
    await Promise.all(Array.from({ length: 3 }, () => abuse.failed(email, ip)));
    expect(await abuse.blocked(email, ip)).toBe(true);
    expect(await abuse.blocked(email, '192.0.2.11')).toBe(false);
    const rows = await fixture.rateLimitBucket.findMany({
      where: { key: { startsWith: 'login:' } },
    });
    expect(
      rows.every((r) => !r.key.includes(email) && !r.key.includes(ip)),
    ).toBe(true);
    await expect(
      auth.login(email, TEST_PASSWORD, { ip }),
    ).rejects.toMatchObject({ message: 'Invalid email or password' });
  });

  it('blocks password spraying across accounts from one IP', async () => {
    const ip = '192.0.2.20';
    for (let i = 0; i < 4; i++)
      await abuse.failed(`missing-${i}@example.invalid`, ip);
    const u = await user();
    await expect(auth.login(u.email, TEST_PASSWORD, { ip })).rejects.toThrow(
      'Invalid email or password',
    );
  });

  it('protects a distributed target while allowing a known source; bad passwords still fail there', async () => {
    const u = await user(),
      known = '192.0.2.30';
    await auth.login(u.email, TEST_PASSWORD, { ip: known });
    for (let i = 0; i < 4; i++) await abuse.failed(u.email, `198.51.100.${i}`);
    await expect(
      auth.login(u.email, TEST_PASSWORD, { ip: '192.0.2.31' }),
    ).rejects.toThrow('Invalid email or password');
    await expect(auth.login(u.email, 'wrong', { ip: known })).rejects.toThrow(
      'Invalid email or password',
    );
    await expect(
      auth.login(u.email, TEST_PASSWORD, { ip: known }),
    ).resolves.toHaveProperty('accessToken');
    expect(
      await fixture.userLoginSource.count({ where: { userId: u.id } }),
    ).toBe(1);
  });

  it('expires blocks without cleanup or a server restart', async () => {
    const email = 'expire@example.invalid',
      ip = '192.0.2.40';
    for (let i = 0; i < 3; i++) await abuse.failed(email, ip);
    expect(await abuse.blocked(email, ip)).toBe(true);
    await fixture.rateLimitBucket.update({
      where: { key: `login:pair:${sourceHash(email, ip)}` },
      data: { blockedUntil: new Date(0), windowExpiresAt: new Date(0) },
    });
    expect(await abuse.blocked(email, ip)).toBe(false);
  });

  it('records concurrent real login failures for an unknown account', async () => {
    const email = 'concurrent-unknown@example.invalid', ip = '192.0.2.45';
    const attempts = await Promise.allSettled(Array.from({ length: 3 }, () => auth.login(email, 'wrong', { ip })));
    expect(attempts.every(a => a.status === 'rejected')).toBe(true);
    expect(await abuse.blocked(email, ip)).toBe(true);
  });

  it('enforces session caps under concurrent logins and updates bounded metadata', async () => {
    const u = await user();
    const pairs = await Promise.all(
      Array.from({ length: 5 }, () =>
        auth.login(u.email, TEST_PASSWORD, {
          ip: '192.0.2.50',
          userAgent: 'x'.repeat(300),
        }),
      ),
    );
    expect(
      await fixture.authSession.count({
        where: { userId: u.id, revokedAt: null },
      }),
    ).toBe(2);
    const principals = await Promise.all(
      pairs.map((p) => auth.authenticateAccessToken(p.accessToken)),
    );
    expect(principals.filter(Boolean)).toHaveLength(2);
    for (let i = 0; i < pairs.length; i++) {
      if (!principals[i])
        await expect(auth.refresh(pairs[i].refreshToken)).rejects.toThrow(
          'Invalid or expired refresh token',
        );
    }
    const live = await fixture.authSession.findFirstOrThrow({
      where: { userId: u.id, revokedAt: null },
    });
    expect(live.userAgent).toHaveLength(200);
    await fixture.authSession.update({
      where: { id: live.id },
      data: { lastSeenAt: new Date(0) },
    });
    const token = pairs.find(
      (p) => principals[pairs.indexOf(p)]?.sessionId === live.id,
    )!;
    await auth.authenticateAccessToken(token.accessToken);
    const seen = (
      await fixture.authSession.findUniqueOrThrow({ where: { id: live.id } })
    ).lastSeenAt;
    await auth.authenticateAccessToken(token.accessToken);
    expect(
      (await fixture.authSession.findUniqueOrThrow({ where: { id: live.id } }))
        .lastSeenAt,
    ).toEqual(seen);
  });

  it('cleans only eligible auth records, in bounded batches, with operator credentials', async () => {
    const u = await user();
    const p1 = await auth.login(u.email, TEST_PASSWORD, { ip: '192.0.2.60' });
    const p2 = await auth.login(u.email, TEST_PASSWORD, { ip: '192.0.2.60' });
    const sessions = await fixture.authSession.findMany({
      where: { userId: u.id },
      orderBy: { createdAt: 'asc' },
    });
    await fixture.authSession.update({
      where: { id: sessions[0].id },
      data: { expiresAt: new Date(0), accessExpiresAt: new Date(0) },
    });
    await fixture.rateLimitBucket.create({
      data: {
        key: 'cleanup-expired',
        hits: 1,
        windowExpiresAt: new Date(-86400000),
      },
    });
    await fixture.rateLimitBucket.create({
      data: {
        key: 'cleanup-blocked',
        hits: 1,
        windowExpiresAt: new Date(0),
        blockedUntil: new Date(Date.now() + 60000),
      },
    });
    const run = (overrides = {}) =>
      spawnSync(process.execPath, ['scripts/cleanup-auth.ts'], {
        env: { ...process.env, AUTH_CLEANUP_BATCH_SIZE: '1', ...overrides },
        encoding: 'utf8',
      });
    const cleaned = run();
    expect(cleaned.status).toBe(0);
    expect(JSON.parse(cleaned.stdout)).toEqual({
      sessionsDeleted: 1,
      bucketsDeleted: 1,
    });
    expect(
      await fixture.authSession.findUnique({ where: { id: sessions[0].id } }),
    ).toBeNull();
    expect(await auth.authenticateAccessToken(p1.accessToken)).toBeNull();
    expect(await auth.authenticateAccessToken(p2.accessToken)).not.toBeNull();
    expect(
      await fixture.rateLimitBucket.findUnique({
        where: { key: 'cleanup-blocked' },
      }),
    ).not.toBeNull();
    expect(
      await fixture.rateLimitBucket.findUnique({
        where: { key: 'cleanup-expired' },
      }),
    ).toBeNull();
    expect(run({ AUTH_CLEANUP_RETENTION_DAYS: '0' }).status).not.toBe(0);
    expect(
      run({ PROVISIONER_DATABASE_URL: process.env['TEST_DATABASE_URL'] })
        .status,
    ).not.toBe(0);
    await expect(runtime.authSession.deleteMany({})).rejects.toThrow();
  });

  it('retains recent revocations but removes old revoked sessions even before absolute expiry', async () => {
    const u = await user();
    for (let i = 0; i < 3; i++) await auth.login(u.email, TEST_PASSWORD, { ip: '192.0.2.70' });
    const rows = await fixture.authSession.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' } });
    await fixture.authSession.update({ where: { id: rows[0].id }, data: { revokedAt: new Date(0) } });
    await fixture.authSession.update({ where: { id: rows[1].id }, data: { revokedAt: new Date() } });
    const result = spawnSync(process.execPath, ['scripts/cleanup-auth.ts'], { env: process.env, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(await fixture.authSession.findUnique({ where: { id: rows[0].id } })).toBeNull();
    expect(await fixture.authSession.count({ where: { id: { in: [rows[1].id, rows[2].id] } } })).toBe(2);
  });
});
