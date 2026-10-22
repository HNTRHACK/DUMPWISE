import { validateEnv } from './env.js';

describe('existing lockout configuration during Phase 2B transition', () => {
  const base = { DATABASE_URL: 'postgresql://localhost/unused' };

  it('keeps validated defaults consumed by AuthService', () => {
    expect(validateEnv(base)).toMatchObject({ AUTH_MAX_FAILED_LOGINS: 5, AUTH_LOCKOUT_SECONDS: 900 });
    expect(validateEnv({ ...base, AUTH_MAX_FAILED_LOGINS: '3', AUTH_LOCKOUT_SECONDS: '60' }))
      .toMatchObject({ AUTH_MAX_FAILED_LOGINS: 3, AUTH_LOCKOUT_SECONDS: 60 });
  });

  it.each([{ AUTH_MAX_FAILED_LOGINS: '0' }, { AUTH_LOCKOUT_SECONDS: '0' }])('rejects unsafe lockout settings: %j', (settings) => {
    expect(() => validateEnv({ ...base, ...settings })).toThrow('Invalid environment configuration');
  });
});
