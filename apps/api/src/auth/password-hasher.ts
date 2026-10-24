import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// Password hashing with scrypt (memory-hard; OWASP-recommended parameters N=2^16, r=8, p=2).
// Stored format: scrypt$<log2 N>$<r>$<p>$<salt base64url>$<key base64url>
// The parameters live inside the hash so they can be raised later without breaking old hashes.

const CURRENT = { logN: 16, r: 8, p: 2 };
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
// Refuse absurd parameters from a tampered hash (would otherwise be a memory/CPU bomb).
const LIMITS = { logN: [14, 20], r: [1, 16], p: [1, 16] } as const;

export const PASSWORD_POLICY = { minLength: 12, maxLength: 128 } as const;

function scrypt(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function options(logN: number, r: number, p: number): ScryptOptions {
  const N = 2 ** logN;
  return { N, r, p, maxmem: 128 * N * r * 2 };
}

// NFKC: the same visible password typed on different keyboards/OSes hashes identically.
const normalize = (password: string) => password.normalize('NFKC');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(normalize(password), salt, options(CURRENT.logN, CURRENT.r, CURRENT.p));
  return ['scrypt', CURRENT.logN, CURRENT.r, CURRENT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export interface VerifyResult {
  valid: boolean;
  /** True when the hash uses older parameters and should be re-hashed after a successful login. */
  needsRehash: boolean;
}

export async function verifyPassword(password: string, stored: string): Promise<VerifyResult> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return { valid: false, needsRehash: false };
  const [logN, r, p] = parts.slice(1, 4).map(Number);
  if (
    !Number.isInteger(logN) || logN < LIMITS.logN[0] || logN > LIMITS.logN[1] ||
    !Number.isInteger(r) || r < LIMITS.r[0] || r > LIMITS.r[1] ||
    !Number.isInteger(p) || p < LIMITS.p[0] || p > LIMITS.p[1]
  ) {
    return { valid: false, needsRehash: false };
  }
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (salt.length < SALT_BYTES || expected.length !== KEY_LENGTH) return { valid: false, needsRehash: false };

  const actual = await scrypt(normalize(password), salt, options(logN, r, p));
  // Constant-time comparison: response time does not reveal how many bytes matched.
  const valid = timingSafeEqual(actual, expected);
  const needsRehash = logN !== CURRENT.logN || r !== CURRENT.r || p !== CURRENT.p;
  return { valid, needsRehash };
}

let dummyHash: Promise<string> | undefined;
/**
 * Spends the same time as a real verification. Called when the user does not exist so that
 * response timing does not reveal which e-mail addresses have accounts.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password, await dummyHash);
}

/**
 * NIST SP 800-63B style policy: length matters, composition rules ("1 symbol, 1 digit") do not.
 * Returns a list of problems (empty = acceptable).
 */
export function checkPasswordPolicy(password: string, context: { email?: string } = {}): string[] {
  const problems: string[] = [];
  const pw = normalize(password);
  if ([...pw].length < PASSWORD_POLICY.minLength) problems.push(`must be at least ${PASSWORD_POLICY.minLength} characters`);
  if ([...pw].length > PASSWORD_POLICY.maxLength) problems.push(`must be at most ${PASSWORD_POLICY.maxLength} characters`);
  if (new Set(pw).size < 5) problems.push('must contain at least 5 different characters');
  const lower = pw.toLowerCase();
  for (const word of ['password', 'dumpwise', 'qwerty', '123456']) {
    if (lower.includes(word)) problems.push(`must not contain "${word}"`);
  }
  const local = context.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 3 && lower.includes(local)) problems.push('must not contain your e-mail name');
  return problems;
}
