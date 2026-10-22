import { checkPasswordPolicy, hashPassword, verifyPassword } from './password-hasher.js';
import { generateToken, hashToken, isTokenFormat } from './tokens.js';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^scrypt\$16\$8\$2\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(hash).not.toContain('correct horse');
    expect(await verifyPassword('correct horse battery staple', hash)).toEqual({ valid: true, needsRehash: false });
    expect((await verifyPassword('correct horse battery stapler', hash)).valid).toBe(false);
  });

  it('salts every hash (same password, different hashes)', async () => {
    expect(await hashPassword('same password here')).not.toBe(await hashPassword('same password here'));
  });

  it('treats Unicode-equivalent input as the same password (NFKC)', async () => {
    const hash = await hashPassword('ｃａｆé-river-stone'); // full-width letters
    expect((await verifyPassword('café-river-stone', hash)).valid).toBe(true);
  });

  it('rejects malformed or tampered hashes without throwing', async () => {
    expect((await verifyPassword('x', 'not-a-hash')).valid).toBe(false);
    expect((await verifyPassword('x', 'scrypt$30$8$2$AAAAAAAAAAAAAAAAAAAAAA$AAAA')).valid).toBe(false); // 2^30 = memory bomb
    expect((await verifyPassword('x', 'bcrypt$16$8$2$a$b')).valid).toBe(false);
  });

  it('flags hashes made with older parameters for re-hashing', async () => {
    const current = await hashPassword('another long passphrase');
    const older = current.replace(/^scrypt\$16\$8\$2/, 'scrypt$15$8$2');
    // Different parameters produce a different key, so this is invalid, but the flag logic is what we check:
    expect((await verifyPassword('another long passphrase', older)).needsRehash).toBe(true);
  });
});

describe('password policy', () => {
  it.each([
    ['short', 'must be at least 12 characters'],
    ['aaaaaaaaaaaaaaaa', 'must contain at least 5 different characters'],
    ['MyPassword2026!', 'must not contain "password"'],
  ])('rejects %s', (pw, problem) => {
    expect(checkPasswordPolicy(pw)).toContain(problem);
  });

  it('rejects a password containing the e-mail name', () => {
    expect(checkPasswordPolicy('ravi.kumar-loves-tea', { email: 'ravi.kumar@example.com' })).toContain('must not contain your e-mail name');
  });

  it('accepts a long passphrase without composition rules', () => {
    expect(checkPasswordPolicy('blue tractor river mango')).toEqual([]);
  });
});

describe('opaque tokens', () => {
  it('are random, prefixed and stored only as a hash', () => {
    const a = generateToken('access');
    expect(isTokenFormat('access', a)).toBe(true);
    expect(isTokenFormat('refresh', a)).toBe(false);
    expect(a).not.toBe(generateToken('access'));
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a.slice(4, 20));
  });
});
