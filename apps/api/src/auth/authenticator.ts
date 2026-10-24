import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';

export interface AuthenticatedPrincipal {
  userId: string;
  sessionId: string;
}

/**
 * Answers "WHO is calling?" (authentication). Returns null when the caller cannot be
 * identified. Implementations are swapped through dependency injection; a future OIDC
 * (e.g. Microsoft Entra ID) authenticator would be another implementation of this interface.
 */
export interface Authenticator {
  authenticate(req: Request): Promise<AuthenticatedPrincipal | null>;
}

export const AUTHENTICATOR = Symbol('AUTHENTICATOR');

const BEARER = /^Bearer ([A-Za-z0-9_-]{1,200})$/i;

/** Reads "Authorization: Bearer <access token>" and resolves it to a live session. */
@Injectable()
export class BearerSessionAuthenticator implements Authenticator {
  constructor(private readonly auth: AuthService) {}

  async authenticate(req: Request): Promise<AuthenticatedPrincipal | null> {
    const match = BEARER.exec(req.header('authorization') ?? '');
    if (!match) return null;
    return this.auth.authenticateAccessToken(match[1]);
  }
}
