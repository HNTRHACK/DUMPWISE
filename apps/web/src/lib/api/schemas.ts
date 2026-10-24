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
  templateVersionId: z.uuid().nullable(),
  rulesVersion: z.string(),
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

export const templateSchema = z.object({
  id: z.uuid(), name: z.string(), description: z.string(), version: z.number().int(),
  organizationId: z.uuid(), sourceType: z.literal('SAP_BILLING_CSV'), createdByUserId: z.uuid(),
  approvedByUserId: z.uuid().nullable(), approvedAt: z.string().nullable(), createdAt: z.string(),
  status: z.enum(['DRAFT', 'APPROVED']), rulesVersion: z.string(),
  mapping: z.object({ columns: z.array(z.object({ field: z.string(), header: z.string() })),
    dateFormat: z.string(), numberFormat: z.enum(['PLAIN', 'EN_GROUPED']), documentTypes: z.record(z.string(), z.string()) }),
});
export const templatesSchema = z.object({ items: z.array(templateSchema), total: z.number().int(), limit: z.number().int(), offset: z.number().int() });
export const templatePreviewSchema = z.object({ ok: z.boolean(), templateVersionId: z.uuid(), rulesVersion: z.string(),
  status: z.enum(['DRAFT', 'APPROVED']), sample: z.array(z.record(z.string(), z.unknown())),
  stats: importStatsSchema.pick({ rowsTotal: true, rowsValid: true, rowsInvalid: true, rowsDuplicateInFile: true }),
  issues: z.array(importIssueSchema), issuesTruncated: z.boolean(), reconciliationStatus: z.literal('NOT_RUN'),
  mapping: z.array(z.object({ field: z.string(), header: z.string(), required: z.boolean(), interpretation: z.string() })),
  limitations: z.array(z.string()),
});
export type ImportTemplate = z.infer<typeof templateSchema>;
export type TemplatePreview = z.infer<typeof templatePreviewSchema>;
export const transactionLineageSchema = z.object({
  id: z.uuid(), billingDocument: z.string(), billingItem: z.string(), billingDate: z.string(), billingType: z.string(),
  sku: z.string(), distributorCode: z.string(), customerCode: z.string(), netAmount: decimal, currency: z.string(),
  productId: z.uuid(), distributorId: z.uuid(), customerId: z.uuid(), cancelledBillingDocument: z.string().nullable(),
  quantity: decimal, unit: z.string(), batchId: z.uuid(), sourceRowNumber: z.number().int(), fileName: z.string(),
  fileSha256: z.string(), templateVersionId: z.uuid().nullable(), rulesVersion: z.string(), sourceFileStatus: z.literal('NOT_RETAINED'),
});
export const transactionsSchema = z.object({ organizationId: z.uuid(), currency: z.string(), from: month, to: month,
  total: z.number().int(), limit: z.number().int(), offset: z.number().int(),
  summary: z.object({ netRevenue: decimal, transactionCount: z.number().int(), units: z.array(unitsSoldSchema) }),
  items: z.array(transactionLineageSchema),
});

export const reportSummarySchema = z.object({ id: z.uuid(), createdAt: z.string(), expiresAt: z.string(),
  configuration: z.object({ from: month, to: month, currency: z.string(), unit: z.string().nullable(), definitionVersion: z.string() }),
});
export const reportSchema = reportSummarySchema.extend({ snapshot: z.object({
  organizationId: z.uuid(), organizationName: z.string(), classification: z.string(), generatedAt: z.string(),
  from: month, to: month, currency: z.string(), unit: z.string().nullable(), definitionVersion: z.string(), metricVersion: z.string(),
  netRevenue: decimal, credits: decimal, returns: decimal, cancellations: decimal, transactionCount: z.number().int(),
  months: z.array(z.object({ month, netRevenue: decimal, lines: z.number().int() })),
  units: z.array(unitsSoldSchema), coverageNote: z.string(),
  sources: z.array(z.object({ id: z.uuid(), fileName: z.string(), publishedAt: z.string(),
    accepted: z.number().int(), rejected: z.number().int(), duplicates: z.number().int(), inserted: z.number().int(),
    checks: z.array(z.object({ passed: z.boolean() })),
  })),
}) });
export const reportListSchema = z.object({ items: z.array(reportSummarySchema), limit: z.number().int(), offset: z.number().int() });
export const pilotAssessmentSchema = z.object({ id: z.uuid(), manualMinutes: decimal, automatedMinutes: decimal,
  laborMinutesDifference: decimal, reviewed: z.boolean(), createdAt: z.string(),
  discrepancies: z.array(z.object({ description: z.string(), status: z.enum(['OPEN', 'RESOLVED']) })),
});
export const pilotHistorySchema = z.object({ reportId: z.uuid(), durationSource: z.literal('USER_ENTERED'),
  reportEvidence: z.object({ generatedExports: z.number().int(), sourceBatches: z.number().int(), activityMonths: z.number().int(),
    acceptedBatchRows: z.number().int(), rejectedBatchRows: z.number().int(), checksPassed: z.number().int(), checksTotal: z.number().int(), reconciliationPassPercent: decimal.nullable() }),
  items: z.array(pilotAssessmentSchema), limit: z.number().int(), offset: z.number().int(),
});

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
