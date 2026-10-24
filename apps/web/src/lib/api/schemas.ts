import { z } from "zod";

// Runtime schemas mirroring the NestJS OpenAPI contract (docs/openapi.json, v0.2.0).
// test/contract.test.ts checks every property here against the OpenAPI document, so a
// backend change that renames or removes a field fails the frontend tests.
// Money and quantities stay DECIMAL STRINGS end to end (never JS floats).

const decimal = z.string().regex(/^-?\d+(\.\d+)?$/, "decimal string");
const isoDate = z.string().min(1);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const roleSchema = z.enum(["OWNER", "ANALYST", "VIEWER"]);
export type Role = z.infer<typeof roleSchema>;

export const membershipSchema = z.object({
  organizationId: z.uuid(),
  organizationName: z.string(),
  organizationSlug: z.string(),
  dataClassification: z.enum(["SYNTHETIC", "PRODUCTION"]),
  role: roleSchema,
});
export type Membership = z.infer<typeof membershipSchema>;

export const meSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  memberships: z.array(membershipSchema),
});
export type Me = z.infer<typeof meSchema>;

export const tokenPairSchema = z.object({
  tokenType: z.literal("Bearer"),
  accessToken: z.string().min(10),
  accessTokenExpiresAt: isoDate,
  refreshToken: z.string().min(10),
  sessionExpiresAt: isoDate,
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

export const unitsSoldSchema = z.object({ unit: z.string(), quantity: decimal });

export const monthlySalesRowSchema = z.object({
  month,
  currency: z.string().regex(/^[A-Z]{3}$/),
  totalNetSales: decimal,
  transactionCount: z.number().int().nonnegative(),
  unitsSold: z.array(unitsSoldSchema),
});
export type MonthlySalesRow = z.infer<typeof monthlySalesRowSchema>;

export const monthlySalesSchema = z.object({
  organizationId: z.uuid(),
  dataClassification: z.enum(["SYNTHETIC", "PRODUCTION"]),
  months: z.array(monthlySalesRowSchema),
});
export type MonthlySales = z.infer<typeof monthlySalesSchema>;

export const importStatusSchema = z.enum([
  "PROCESSING",
  "FAILED_VALIDATION",
  "RECONCILIATION_FAILED",
  "READY_TO_PUBLISH",
  "PUBLISHED",
]);
export type ImportStatus = z.infer<typeof importStatusSchema>;

export const importStatsSchema = z.object({
  rowsTotal: z.number().int(),
  rowsValid: z.number().int(),
  rowsInvalid: z.number().int(),
  rowsDuplicateInFile: z.number().int(),
  rowsAlreadyImported: z.number().int(),
  rowsInserted: z.number().int(),
});
export type ImportStats = z.infer<typeof importStatsSchema>;

export const reconciliationCheckSchema = z.object({
  metric: z.enum(["NET_AMOUNT", "LINE_COUNT", "QUANTITY"]),
  month,
  currency: z.string().nullable(),
  unit: z.string().nullable(),
  expected: z.string(),
  actual: z.string(),
  passed: z.boolean(),
});
export type ReconciliationCheck = z.infer<typeof reconciliationCheckSchema>;

export const importIssueSchema = z.object({
  severity: z.enum(["error", "warning", "info"]),
  code: z.string(),
  message: z.string(),
  line: z.number().int().optional(),
  field: z.string().optional(),
});
export type ImportIssue = z.infer<typeof importIssueSchema>;

export const importResultSchema = z.object({
  outcome: z.enum(["IMPORTED", "ALREADY_IMPORTED", "FAILED_VALIDATION", "RECONCILIATION_FAILED"]),
  batchId: z.uuid(),
  status: importStatusSchema,
  stats: importStatsSchema,
  reconciliation: z.array(reconciliationCheckSchema),
  issues: z.array(importIssueSchema),
});
export type ImportResult = z.infer<typeof importResultSchema>;

export const importBatchSummarySchema = z.object({
  id: z.uuid(),
  fileName: z.string(),
  fileSha256: z.string(),
  fileSizeBytes: z.number().int(),
  isSynthetic: z.boolean(),
  status: importStatusSchema,
  reconciliationStatus: z.enum(["NOT_RUN", "PASSED", "FAILED"]),
  stats: importStatsSchema,
  createdAt: isoDate,
  createdByUserId: z.uuid().nullable(),
  publishedAt: isoDate.nullable(),
  publishedByUserId: z.uuid().nullable(),
});
export type ImportBatchSummary = z.infer<typeof importBatchSummarySchema>;

export const importBatchListSchema = z.object({
  items: z.array(importBatchSummarySchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type ImportBatchList = z.infer<typeof importBatchListSchema>;

export const importBatchDetailSchema = importBatchSummarySchema.extend({
  issues: z.array(importIssueSchema),
  reconciliation: z.array(reconciliationCheckSchema),
});
export type ImportBatchDetail = z.infer<typeof importBatchDetailSchema>;

/** The API's uniform error body. */
export const errorBodySchema = z.object({
  statusCode: z.number().int(),
  error: z.string().optional(),
  message: z.union([z.string(), z.array(z.string())]),
  path: z.string().optional(),
  timestamp: z.string().optional(),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

export const loginRequestSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
});

// Phase 4: amounts remain decimal strings all the way to display.
export const analyticsRowSchema = z.object({
 id: z.uuid(), code: z.string(), name: z.string().nullable(), unit: z.string(),
 netRevenue: decimal, creditedAmount: decimal, returnedAmount: decimal, cancelledAmount: decimal,
 netQuantity: decimal, transactionCount: z.number().int(), previousRevenue: decimal,
 growthPercent: decimal.nullable(), growthReason: z.string().nullable(),
});
export const analyticsSummarySchema = z.object({
 netRevenue: decimal, creditedAmount: decimal, returnedAmount: decimal, cancelledAmount: decimal,
 transactionCount: z.number().int(), units: z.array(unitsSoldSchema),
});
export const analyticsSchema = z.object({
 organizationId: z.uuid(), currency: z.string(), from: month, to: month, previousFrom: month, previousTo: month,
 items: z.array(analyticsRowSchema), summary: analyticsSummarySchema,
 total: z.number().int(), limit: z.number().int(), offset: z.number().int(),
});
export const productTrendSchema = monthlySalesSchema.extend({ productId: z.uuid() });
