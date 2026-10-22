import { Injectable } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthenticatedPrincipal {
  userId: string;
}

/**
 * Answers "WHO is calling?" (authentication). Returns null when the caller cannot be
 * identified. Implementations are swapped through dependency injection.
 */
export interface Authenticator {
  authenticate(req: Request): Promise<AuthenticatedPrincipal | null>;
}

export const AUTHENTICATOR = Symbol('AUTHENTICATOR');

/**
 * Phase 1 production default: no identity provider is integrated yet, so NOBODY is
 * authenticated and every protected endpoint answers 401. This is deliberate: protected
 * data APIs are not exposed behind fake authentication. Tests replace this provider
 * with a test-only authenticator that lives outside src/ and is never built or deployed.
 */
@Injectable()
export class DisabledAuthenticator implements Authenticator {
  authenticate(): Promise<AuthenticatedPrincipal | null> {
    return Promise.resolve(null);
  }
}
