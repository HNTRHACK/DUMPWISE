// Operator CLI for Phase 1. Runs the same services as the API (same authorization rules)
// without starting an HTTP server. Usage: node dist/cli/dumpwise.js <command> [options]
//
//   seed-synthetic
//   import   --org <slug> --actor <email> --file <csv> --control-totals <json> [--number-format PLAIN|EN_GROUPED]
//   publish  --org <slug> --actor <email> --batch <uuid>
//   monthly  --org <slug> --actor <email> [--from YYYY-MM] [--to YYYY-MM]
//   openapi  --out <file>
//   create-user     --email <email> --name <display name>
//   add-member      --org <slug> --email <email> --role OWNER|ANALYST|VIEWER
//   reset-password  --email <email>     (prints a generated password ONCE; revokes sessions)
import { randomBytes } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { buildOpenApiDocument } from '../app.setup.js';
import { AuthService } from '../auth/auth.service.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import type { Env } from '../config/env.js';
import { ImportPipelineService } from '../imports/import-pipeline.service.js';
import { PublicationService } from '../imports/publication.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SalesService } from '../sales/sales.service.js';

const SYNTHETIC_ORG = { slug: 'synthetic-demo', name: 'Synthetic Demo Manufacturing Co. (SYNTHETIC)' };
const SYNTHETIC_USERS = [
  { email: 'demo.owner@example.invalid', displayName: 'Demo Owner (SYNTHETIC)', role: 'OWNER' as const },
  { email: 'demo.analyst@example.invalid', displayName: 'Demo Analyst (SYNTHETIC)', role: 'ANALYST' as const },
];

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    org: { type: 'string' },
    actor: { type: 'string' },
    file: { type: 'string' },
    'control-totals': { type: 'string' },
    'number-format': { type: 'string', default: 'PLAIN' },
    batch: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    out: { type: 'string' },
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string' },
  },
});

function need(name: keyof typeof values): string {
  const v = values[name];
  if (typeof v !== 'string' || v === '') throw new Error(`--${name} is required`);
  return v;
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const prisma = app.get(PrismaService);
const log = new Logger('cli');

async function resolve(): Promise<{ organizationId: string; userId: string }> {
  const org = await prisma.organization.findUnique({ where: { slug: need('org') } });
  const user = await prisma.user.findUnique({ where: { email: need('actor').toLowerCase() } });
  if (!org || !user) throw new Error('Unknown organization or actor');
  return { organizationId: org.id, userId: user.id };
}

try {
  switch (positionals[0]) {
    case 'seed-synthetic': {
      const org = await prisma.organization.upsert({
        where: { slug: SYNTHETIC_ORG.slug },
        update: {},
        create: { ...SYNTHETIC_ORG, dataClassification: 'SYNTHETIC' },
      });
      if (org.dataClassification !== 'SYNTHETIC') throw new Error(`${org.slug} exists and is not SYNTHETIC`);
      for (const u of SYNTHETIC_USERS) {
        const user = await prisma.user.upsert({
          where: { email: u.email },
          update: {},
          create: { email: u.email, displayName: u.displayName },
        });
        await prisma.membership.upsert({
          where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
          update: {},
          create: { organizationId: org.id, userId: user.id, role: u.role },
        });
      }
      console.log(JSON.stringify({ organizationId: org.id, slug: org.slug, users: SYNTHETIC_USERS.map((u) => `${u.email} (${u.role})`) }, null, 2));
      break;
    }
    case 'import': {
      const { organizationId, userId } = await resolve();
      const file = need('file');
      const maxBytes = app.get<ConfigService<Env, true>>(ConfigService).get('IMPORT_MAX_BYTES', { infer: true });
      // Check size BEFORE reading the file into memory.
      if (statSync(file).size > maxBytes) throw new Error(`File exceeds IMPORT_MAX_BYTES (${maxBytes})`);
      const format = need('number-format');
      if (format !== 'PLAIN' && format !== 'EN_GROUPED') throw new Error('--number-format must be PLAIN or EN_GROUPED');
      const result = await app.get(ImportPipelineService).importBillingCsv({
        organizationId,
        actorUserId: userId,
        fileName: file,
        content: readFileSync(file),
        controlTotals: JSON.parse(readFileSync(need('control-totals'), 'utf8')) as unknown,
        numberFormat: format,
      });
      const failed = result.reconciliation.filter((c) => !c.passed);
      console.log(JSON.stringify({
        outcome: result.outcome,
        batchId: result.batchId,
        status: result.status,
        stats: result.stats,
        reconciliation: { checks: result.reconciliation.length, failed: failed.length, failures: failed.slice(0, 20) },
        issueSample: result.issues.filter((i) => i.severity !== 'info').slice(0, 15),
      }, null, 2));
      if (result.outcome === 'FAILED_VALIDATION' || result.outcome === 'RECONCILIATION_FAILED') process.exitCode = 2;
      break;
    }
    case 'publish': {
      const { organizationId, userId } = await resolve();
      const batch = await app.get(PublicationService).publish(organizationId, need('batch'), userId);
      console.log(JSON.stringify({ batchId: batch.id, status: batch.status, publishedAt: batch.publishedAt }, null, 2));
      break;
    }
    case 'monthly': {
      const { organizationId, userId } = await resolve();
      const access = await app.get(OrganizationAccessService).require(userId, organizationId);
      const res = await app.get(SalesService).monthly(access, { from: values.from, to: values.to });
      console.log(JSON.stringify(res, null, 2));
      break;
    }
    case 'openapi': {
      const httpApp = await NestFactory.create(AppModule, { logger: false });
      writeFileSync(need('out'), JSON.stringify(buildOpenApiDocument(httpApp), null, 2) + '\n');
      await httpApp.close();
      console.log(`OpenAPI document written to ${need('out')}`);
      break;
    }
    case 'create-user': {
      const email = need('email').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) throw new Error('Invalid --email');
      const user = await prisma.user.create({ data: { email, displayName: need('name').slice(0, 120) } });
      console.log(JSON.stringify({ userId: user.id, email: user.email, note: 'No password yet: run reset-password' }, null, 2));
      break;
    }
    case 'add-member': {
      const role = need('role');
      if (role !== 'OWNER' && role !== 'ANALYST' && role !== 'VIEWER') throw new Error('--role must be OWNER, ANALYST or VIEWER');
      const org = await prisma.organization.findUnique({ where: { slug: need('org') } });
      const user = await prisma.user.findUnique({ where: { email: need('email').toLowerCase() } });
      if (!org || !user) throw new Error('Unknown organization or user');
      const m = await prisma.membership.upsert({
        where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
        update: { role },
        create: { organizationId: org.id, userId: user.id, role },
      });
      console.log(JSON.stringify({ organization: org.slug, email: user.email, role: m.role }, null, 2));
      break;
    }
    case 'reset-password': {
      const user = await prisma.user.findUnique({ where: { email: need('email').toLowerCase() } });
      if (!user) throw new Error('Unknown user');
      // 144 random bits; shown once and never stored in plain text.
      const password = randomBytes(18).toString('base64url');
      await app.get(AuthService).setPassword(user.id, password);
      console.log(`Temporary password for ${user.email} (shown once; change it via POST /v1/auth/change-password):`);
      console.log(password);
      break;
    }
    default:
      console.error('Commands: seed-synthetic | import | publish | monthly | openapi | create-user | add-member | reset-password');
      process.exitCode = 1;
  }
} catch (e) {
  log.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  await app.close();
}
