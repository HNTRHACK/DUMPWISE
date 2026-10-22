import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { checkPasswordPolicy, hashPassword, verifyAgainstDummy, verifyPassword } from './password-hasher.js';
import { generateToken, hashToken, isTokenFormat } from './tokens.js';

export interface TokenPair {
  tokenType: 'Bearer';
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  sessionExpiresAt: string;
}

export interface SessionPrincipal {
  userId: string;
  sessionId: string;
}

// One message for every login failure: the caller cannot tell whether the e-mail exists,
// the password was wrong, or the account is locked or disabled (no account enumeration).
const LOGIN_FAILED = 'Invalid email or password';
const INVALID_REFRESH = 'Invalid or expired refresh token';

const emailFingerprint = (email: string) => createHash('sha256').update(email).digest('hex').slice(0, 16);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
  ) {}

  private cfg<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  /** Authentication step 1: exchange e-mail + password for a new session. */
  async login(emailInput: string, password: string): Promise<TokenPair> {
    const email = emailInput.trim().toLowerCase();
    const now = new Date();
    const user = await this.prisma.user.findUnique({ where: { email } });

    const fail = async (reason: string, actorUserId: string | null) => {
      await this.audit.record({
        organizationId: null, actorUserId, action: 'LOGIN_FAILED', entityType: 'User', entityId: actorUserId,
        metadata: { reason, emailSha256: emailFingerprint(email) },
      });
      return new UnauthorizedException(LOGIN_FAILED);
    };

    if (!user || !user.passwordHash || user.disabledAt) {
      await verifyAgainstDummy(password); // equalize timing with the real path
      throw await fail(!user ? 'unknown_user' : user.disabledAt ? 'disabled' : 'no_password', user?.id ?? null);
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      await verifyAgainstDummy(password);
      throw await fail('locked', user.id);
    }

    const result = await verifyPassword(password, user.passwordHash);
    if (!result.valid) {
      await this.registerFailedAttempt(user.id, now);
      throw await fail('bad_password', user.id);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        // Transparent upgrade when hashing parameters were raised since the last login.
        ...(result.needsRehash ? { passwordHash: await hashPassword(password) } : {}),
      },
    });
    const pair = await this.createSession(user.id, now);
    await this.audit.record({ organizationId: null, actorUserId: user.id, action: 'LOGIN_SUCCEEDED', entityType: 'User', entityId: user.id });
    return pair;
  }

  /** Atomic increment; the Nth consecutive failure locks the account for a while. */
  private async registerFailedAttempt(userId: string, now: Date): Promise<void> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    if (updated.failedLoginCount >= this.cfg('AUTH_MAX_FAILED_LOGINS')) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + this.cfg('AUTH_LOCKOUT_SECONDS') * 1000) },
      });
      await this.audit.record({ organizationId: null, actorUserId: userId, action: 'ACCOUNT_LOCKED', entityType: 'User', entityId: userId });
    }
  }

  private async createSession(userId: string, now: Date): Promise<TokenPair> {
    const accessToken = generateToken('access');
    const refreshToken = generateToken('refresh');
    const expiresAt = new Date(now.getTime() + this.cfg('AUTH_SESSION_TTL_SECONDS') * 1000);
    const accessExpiresAt = this.accessExpiry(now, expiresAt);
    await this.prisma.authSession.create({
      data: {
        userId,
        accessTokenHash: hashToken(accessToken),
        accessExpiresAt,
        refreshTokenHash: hashToken(refreshToken),
        expiresAt,
      },
    });
    return this.pair(accessToken, accessExpiresAt, refreshToken, expiresAt);
  }

  private accessExpiry(now: Date, sessionExpiresAt: Date): Date {
    const t = now.getTime() + this.cfg('AUTH_ACCESS_TOKEN_TTL_SECONDS') * 1000;
    return new Date(Math.min(t, sessionExpiresAt.getTime()));
  }

  private pair(accessToken: string, accessExpiresAt: Date, refreshToken: string, expiresAt: Date): TokenPair {
    return {
      tokenType: 'Bearer',
      accessToken,
      accessTokenExpiresAt: accessExpiresAt.toISOString(),
      refreshToken,
      sessionExpiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Refresh-token ROTATION: every refresh returns a new access AND refresh token and
   * invalidates the old ones. If an already-rotated refresh token is presented again,
   * someone holds a stolen copy, so the whole session is revoked (reuse detection).
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    if (!isTokenFormat('refresh', refreshToken)) throw new UnauthorizedException(INVALID_REFRESH);
    const hash = hashToken(refreshToken);
    const now = new Date();

    const session = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash: hash },
      include: { user: { select: { disabledAt: true } } },
    });
    if (!session) {
      const reused = await this.prisma.authSession.findUnique({ where: { previousRefreshTokenHash: hash } });
      if (reused && !reused.revokedAt) {
        await this.revoke(reused.id, 'refresh_token_reuse');
        await this.audit.record({ organizationId: null, actorUserId: reused.userId, action: 'TOKEN_REUSE_DETECTED', entityType: 'AuthSession', entityId: reused.id });
      }
      throw new UnauthorizedException(INVALID_REFRESH);
    }
    if (session.revokedAt || session.expiresAt <= now || session.user.disabledAt) {
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    const accessToken = generateToken('access');
    const newRefresh = generateToken('refresh');
    const accessExpiresAt = this.accessExpiry(now, session.expiresAt);
    // Conditional update: if two requests race with the same refresh token, only one wins.
    const res = await this.prisma.authSession.updateMany({
      where: { id: session.id, refreshTokenHash: hash, revokedAt: null },
      data: {
        accessTokenHash: hashToken(accessToken),
        accessExpiresAt,
        refreshTokenHash: hashToken(newRefresh),
        previousRefreshTokenHash: hash,
        lastRefreshedAt: now,
      },
    });
    if (res.count !== 1) throw new UnauthorizedException(INVALID_REFRESH);
    return this.pair(accessToken, accessExpiresAt, newRefresh, session.expiresAt);
  }

  /** Called on every protected request: is this access token a live session? */
  async authenticateAccessToken(accessToken: string): Promise<SessionPrincipal | null> {
    if (!isTokenFormat('access', accessToken)) return null;
    const session = await this.prisma.authSession.findUnique({
      where: { accessTokenHash: hashToken(accessToken) },
      include: { user: { select: { disabledAt: true } } },
    });
    const now = new Date();
    if (!session || session.revokedAt || session.accessExpiresAt <= now || session.expiresAt <= now || session.user.disabledAt) {
      return null;
    }
    return { userId: session.userId, sessionId: session.id };
  }

  async logout(principal: SessionPrincipal): Promise<void> {
    await this.revoke(principal.sessionId, 'logout');
    await this.audit.record({ organizationId: null, actorUserId: principal.userId, action: 'LOGOUT', entityType: 'AuthSession', entityId: principal.sessionId });
  }

  async changePassword(principal: SessionPrincipal, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: principal.userId } });
    const now = new Date();
    if (!user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash)).valid) {
      // A stolen access token must not become a free password-guessing oracle.
      await this.registerFailedAttempt(user.id, now);
      throw new ForbiddenException('Current password is incorrect');
    }
    if (currentPassword === newPassword) throw new BadRequestException('New password must differ from the current one');
    await this.setPassword(user.id, newPassword, { keepSessionId: principal.sessionId });
    await this.audit.record({ organizationId: null, actorUserId: user.id, action: 'PASSWORD_CHANGED', entityType: 'User', entityId: user.id });
  }

  /**
   * Sets a password (self-service change or operator reset) and revokes the user's other
   * sessions, so a password change locks out anyone who had stolen a token.
   */
  async setPassword(userId: string, password: string, opts: { keepSessionId?: string } = {}): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    const problems = checkPasswordPolicy(password, { email: user.email });
    if (problems.length) throw new BadRequestException(problems.map((p) => `Password ${p}`));
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
      }),
      this.prisma.authSession.updateMany({
        where: { userId, revokedAt: null, ...(opts.keepSessionId ? { id: { not: opts.keepSessionId } } : {}) },
        data: { revokedAt: new Date(), revokedReason: 'password_changed' },
      }),
    ]);
  }

  private async revoke(sessionId: string, reason: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }
}
