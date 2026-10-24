import { SetMetadata, type ExecutionContext } from '@nestjs/common';

// Credential-handling routes get a much stricter per-IP rate limit than the rest of the
// API, to slow down password guessing and credential stuffing.
export const AUTH_RATE_LIMITED = 'dumpwise:auth-rate-limited';
export const AuthRateLimited = () => SetMetadata(AUTH_RATE_LIMITED, true);

export function isAuthRateLimited(context: ExecutionContext): boolean {
  return Reflect.getMetadata(AUTH_RATE_LIMITED, context.getHandler()) === true;
}
