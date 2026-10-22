import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

loadEnv({ quiet: true });

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // All e2e files share one database; run them one after another.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // The app under test connects to the isolated test database as the restricted role.
    env: { NODE_ENV: 'test', DATABASE_URL: process.env['TEST_DATABASE_URL'] ?? '' },
  },
});
