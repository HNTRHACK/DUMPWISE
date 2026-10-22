import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AuthService } from '../src/auth/auth.service.js';
import type { DataClassification } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

/** The real application with the real authentication (no test-only shortcuts). */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

export const TEST_PASSWORD = 'blue tractor river mango 42';

/** Gives the user a password and logs in through POST /v1/auth/login. Returns the token pair. */
export async function loginAs(app: INestApplication, userId: string) {
  const prisma = app.get(PrismaService);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.passwordHash) await app.get(AuthService).setPassword(userId, TEST_PASSWORD);
  const res = await request(app.getHttpServer())
    .post('/v1/auth/login')
    .send({ email: user.email, password: TEST_PASSWORD })
    .expect(200);
  return res.body as { accessToken: string; refreshToken: string; accessTokenExpiresAt: string; sessionExpiresAt: string };
}

export interface Tenant {
  organizationId: string;
  ownerId: string;
  analystId: string;
  viewerId: string;
}

export async function createTenant(
  prisma: PrismaService,
  classification: DataClassification = 'SYNTHETIC',
): Promise<Tenant> {
  const tag = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({
    data: { name: `Test Org ${tag} (SYNTHETIC)`, slug: `test-${tag}`, dataClassification: classification },
  });
  const ids: Record<string, string> = {};
  for (const role of ['OWNER', 'ANALYST', 'VIEWER'] as const) {
    const user = await prisma.user.create({
      data: { email: `${role.toLowerCase()}-${tag}@example.invalid`, displayName: `${role} ${tag}` },
    });
    await prisma.membership.create({ data: { organizationId: org.id, userId: user.id, role } });
    ids[role] = user.id;
  }
  return { organizationId: org.id, ownerId: ids.OWNER, analystId: ids.ANALYST, viewerId: ids.VIEWER };
}

// ---- Small hand-written fixtures --------------------------------------------------

const HEADER =
  'Billing Date,Billing Document,Item,Billing Type,Sold-To Party,Sold-To Name,Material,Material Description,Ship-To Party,Billed Quantity,Sales Unit,Net Value,Doc. Currency,Cancelled Bill. Doc.';

export interface FixtureRow {
  date?: string;
  doc: string;
  item?: string;
  type?: string;
  qty?: string;
  unit?: string;
  amount: string;
  currency?: string;
  cancelled?: string;
  sku?: string;
}

export function csvOf(rows: FixtureRow[]): Buffer {
  const lines = rows.map((r) =>
    [
      r.date ?? '15.09.2026', r.doc, r.item ?? '000010', r.type ?? 'F2', '0000100001', 'SYNTHETIC Dist',
      r.sku ?? 'SYN-MAT-0001', 'SYNTHETIC Product', '0000200001', r.qty ?? '1', r.unit ?? 'EA', r.amount,
      r.currency ?? 'INR', r.cancelled ?? '',
    ].join(','),
  );
  return Buffer.from([HEADER, ...lines].join('\n') + '\n', 'utf8');
}

export function controlTotals(
  totals: { month: string; currency: string; netAmount: string; lineCount: number }[],
  quantityTotals: { month: string; unit: string; quantity: string }[],
  synthetic = true,
) {
  return { schemaVersion: 1, synthetic, totals, quantityTotals };
}

// ---- The committed synthetic dataset ----------------------------------------------

const SYNTHETIC_STEM = resolve(process.cwd(), '../../data/synthetic/SYNTHETIC_sap_billing_2025-10_to_2026-09');

export interface SyntheticControlTotals {
  totals: { month: string; currency: string; netAmount: string; lineCount: number }[];
  quantityTotals: { month: string; unit: string; quantity: string }[];
  expectedIssues: {
    validUniqueRows: number;
    exactDuplicateRows: number;
    conflictingKeyRows: number;
    invalidRows: number;
  };
}

export function loadSyntheticDataset(): { csv: Buffer; control: SyntheticControlTotals } {
  return {
    csv: readFileSync(`${SYNTHETIC_STEM}.csv`),
    control: JSON.parse(readFileSync(`${SYNTHETIC_STEM}.control_totals.json`, 'utf8')) as SyntheticControlTotals,
  };
}
