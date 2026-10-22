import { z } from 'zod';

// Every environment variable the API reads is declared and validated here.
// The app refuses to start if any value is missing or malformed.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgresql:// URL'),
  IMPORT_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(100 * 1024 * 1024)
    .default(20 * 1024 * 1024),
  IMPORT_MAX_ROWS: z.coerce.number().int().min(1).max(1_000_000).default(200_000),
  // Authentication
  AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().min(3600).max(30 * 86400).default(7 * 86400),
  AUTH_MAX_FAILED_LOGINS: z.coerce.number().int().min(3).max(20).default(5),
  AUTH_LOCKOUT_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
  // Rate limits (requests per minute per client IP)
  RATE_LIMIT_AUTH_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(10),
  RATE_LIMIT_DEFAULT_PER_MINUTE: z.coerce.number().int().min(1).max(1_000_000).default(300),
  ENABLE_API_DOCS: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    // Only field names and messages are printed, never values (they may be secrets).
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
