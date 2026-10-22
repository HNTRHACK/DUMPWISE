import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// The Prisma CLI (migrate, studio) connects with the admin/owner role.
// The running API uses DATABASE_URL, a restricted role (see scripts/setup-db-roles.ts).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['MIGRATION_DATABASE_URL'],
  },
});
