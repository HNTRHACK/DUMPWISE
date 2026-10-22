import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { hashToken } from '../src/auth/tokens.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTenant, createTestApp, loginAs, TEST_PASSWORD, type Tenant } from './helpers.js';

describe('Authentication (/v1/auth)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let t: Tenant;
  const http = () => request(app.getHttpServer());
  const email = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email;
  const me = (token: string) => http().get('/v1/auth/me').auth(token, { type: 'bearer' });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    t = await createTenant(prisma);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('login', () => {
    it('returns an opaque token pair, never cached, and /me works with it', async () => {
      const tokens = await loginAs(app, t.analystId);
      expect(tokens.accessToken).toMatch(/^dwa_[A-Za-z0-9_-]{43}$/);
      expect(tokens.refreshToken).toMatch(/^dwr_[A-Za-z0-9_-]{43}$/);
      const expiresInMs = Date.parse(tokens.accessTokenExpiresAt) - Date.now();
      expect(expiresInMs).toBeGreaterThan(14 * 60_000);
      expect(expiresInMs).toBeLessThanOrEqual(15 * 60_000);

      const res = await me(tokens.accessToken).expect(200);
      expect(res.body).toMatchObject({ id: t.analystId, memberships: [{ organizationId: t.organizationId, role: 'ANALYST' }] });

      const raw = await http().post('/v1/auth/login').send({ email: await email(t.analystId), password: TEST_PASSWORD }).expect(200);
      expect(raw.headers['cache-control']).toBe('no-store');
    });

    it('stores only hashes of tokens and passwords', async () => {
      const tokens = await loginAs(app, t.analystId);
      const session = await prisma.authSession.findUniqueOrThrow({ where: { accessTokenHash: hashToken(tokens.accessToken) } });
      expect(JSON.stringify(session)).not.toContain(tokens.accessToken);
      expect(JSON.stringify(session)).not.toContain(tokens.refreshToken);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: t.analystId } });
      expect(user.passwordHash).toMatch(/^scrypt\$/);
      expect(user.passwordHash).not.toContain(TEST_PASSWORD);
    });

    it('gives the same answer for a wrong password and an unknown e-mail', async () => {
      await loginAs(app, t.viewerId);
      const wrong = await http().post('/v1/auth/login').send({ email: await email(t.viewerId), password: 'not the password' }).expect(401);
      const unknown = await http().post('/v1/auth/login').send({ email: 'nobody@example.invalid', password: 'whatever' }).expect(401);
      expect(wrong.body.message).toBe('Invalid email or password');
      expect(unknown.body.message).toBe(wrong.body.message);
    });

    it('validates the request body', async () => {
      await http().post('/v1/auth/login').send({ email: 'not-an-email', password: 'x' }).expect(400);
      await http().post('/v1/auth/login').send({ email: 'a@example.invalid', password: 'x'.repeat(129) }).expect(400);
      await http().post('/v1/auth/login').send({ email: 'a@example.invalid', password: 'x', admin: true }).expect(400);
    });

    it('locks the account after 5 failed attempts, even for the correct password', async () => {
      const victim = await createTenant(prisma);
      await loginAs(app, victim.ownerId);
      const addr = await email(victim.ownerId);
      for (let i = 0; i < 5; i++) {
        await http().post('/v1/auth/login').send({ email: addr, password: `wrong guess ${i}` }).expect(401);
      }
      await http().post('/v1/auth/login').send({ email: addr, password: TEST_PASSWORD }).expect(401);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: victim.ownerId } });
      expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
      expect(await prisma.auditEvent.count({ where: { actorUserId: victim.ownerId, action: 'ACCOUNT_LOCKED' } })).toBe(1);

      // After the lockout expires, the correct password works again.
      await prisma.user.update({ where: { id: victim.ownerId }, data: { lockedUntil: new Date(Date.now() - 1000) } });
      await http().post('/v1/auth/login').send({ email: addr, password: TEST_PASSWORD }).expect(200);
    });

    it('refuses disabled users and kills their existing sessions', async () => {
      const u = await createTenant(prisma);
      const tokens = await loginAs(app, u.viewerId);
      await prisma.user.update({ where: { id: u.viewerId }, data: { disabledAt: new Date() } });
      await me(tokens.accessToken).expect(401);
      await http().post('/v1/auth/login').send({ email: await email(u.viewerId), password: TEST_PASSWORD }).expect(401);
    });
  });

  describe('session lifecycle', () => {
    it('logout revokes the access token immediately', async () => {
      const tokens = await loginAs(app, t.ownerId);
      await me(tokens.accessToken).expect(200);
      await http().post('/v1/auth/logout').auth(tokens.accessToken, { type: 'bearer' }).expect(204);
      await me(tokens.accessToken).expect(401);
      await http().post('/v1/auth/refresh').send({ refreshToken: tokens.refreshToken }).expect(401);
    });

    it('expired access tokens are rejected; refresh issues a new pair and retires the old one', async () => {
      const tokens = await loginAs(app, t.ownerId);
      await prisma.authSession.update({
        where: { accessTokenHash: hashToken(tokens.accessToken) },
        data: { accessExpiresAt: new Date(Date.now() - 1000) },
      });
      await me(tokens.accessToken).expect(401);

      const res = await http().post('/v1/auth/refresh').send({ refreshToken: tokens.refreshToken }).expect(200);
      expect(res.body.accessToken).not.toBe(tokens.accessToken);
      expect(res.body.refreshToken).not.toBe(tokens.refreshToken);
      expect(res.body.sessionExpiresAt).toBe(tokens.sessionExpiresAt); // refresh never extends the session
      await me(res.body.accessToken).expect(200);
    });

    it('detects refresh-token reuse and revokes the whole session', async () => {
      const tokens = await loginAs(app, t.ownerId);
      const rotated = await http().post('/v1/auth/refresh').send({ refreshToken: tokens.refreshToken }).expect(200);
      // An attacker replays the old refresh token:
      await http().post('/v1/auth/refresh').send({ refreshToken: tokens.refreshToken }).expect(401);
      // ...which also kills the legitimate user's newer tokens.
      await me(rotated.body.accessToken).expect(401);
      await http().post('/v1/auth/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(401);
      expect(await prisma.auditEvent.count({ where: { actorUserId: t.ownerId, action: 'TOKEN_REUSE_DETECTED' } })).toBeGreaterThanOrEqual(1);
    });

    it('sessions past their absolute expiry cannot be refreshed', async () => {
      const tokens = await loginAs(app, t.ownerId);
      const past = new Date(Date.now() - 1000);
      await prisma.authSession.update({
        where: { accessTokenHash: hashToken(tokens.accessToken) },
        data: { accessExpiresAt: past, expiresAt: past },
      });
      await http().post('/v1/auth/refresh').send({ refreshToken: tokens.refreshToken }).expect(401);
    });
  });

  describe('change password', () => {
    it('requires the current password, enforces the policy and revokes other sessions', async () => {
      const u = await createTenant(prisma);
      const phone = await loginAs(app, u.analystId);
      const laptop = await loginAs(app, u.analystId);
      const change = (body: object) =>
        http().post('/v1/auth/change-password').auth(laptop.accessToken, { type: 'bearer' }).send(body);

      await change({ currentPassword: 'wrong one', newPassword: 'a brand new passphrase' }).expect(403);
      await change({ currentPassword: TEST_PASSWORD, newPassword: 'aaaaaaaaaaaaaaaa' }).expect(400);
      await change({ currentPassword: TEST_PASSWORD, newPassword: 'a brand new passphrase' }).expect(204);

      await me(laptop.accessToken).expect(200); // the session that changed it stays
      await me(phone.accessToken).expect(401); // every other session is revoked
      const addr = await email(u.analystId);
      await http().post('/v1/auth/login').send({ email: addr, password: TEST_PASSWORD }).expect(401);
      await http().post('/v1/auth/login').send({ email: addr, password: 'a brand new passphrase' }).expect(200);
    });

    it('operator reset (CLI path) revokes all sessions', async () => {
      const u = await createTenant(prisma);
      const tokens = await loginAs(app, u.viewerId);
      await app.get(AuthService).setPassword(u.viewerId, 'operator chosen passphrase');
      await me(tokens.accessToken).expect(401);
    });
  });

  it('records security events in the audit log without an organization', async () => {
    const events = await prisma.auditEvent.findMany({ where: { actorUserId: t.analystId, action: 'LOGIN_SUCCEEDED' } });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.organizationId === null)).toBe(true);
  });
});
