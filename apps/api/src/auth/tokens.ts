import { createHash, randomBytes } from 'node:crypto';

// Opaque bearer tokens: 256 random bits, prefixed so secret scanners (and humans) can tell
// what a leaked string is. Only SHA-256(token) is stored. A fast hash is correct here
// (unlike passwords) because a 256-bit random value cannot be guessed or brute-forced.

export type TokenKind = 'access' | 'refresh';

const PREFIX: Record<TokenKind, string> = { access: 'dwa_', refresh: 'dwr_' };
const FORMAT: Record<TokenKind, RegExp> = {
  access: /^dwa_[A-Za-z0-9_-]{43}$/,
  refresh: /^dwr_[A-Za-z0-9_-]{43}$/,
};

export function generateToken(kind: TokenKind): string {
  return PREFIX[kind] + randomBytes(32).toString('base64url');
}

export function isTokenFormat(kind: TokenKind, value: string): boolean {
  return FORMAT[kind].test(value);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
