import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  importBatchDetailSchema,
  importBatchListSchema,
  importBatchSummarySchema,
  importIssueSchema,
  importResultSchema,
  importStatsSchema,
  meSchema,
  membershipSchema,
  monthlySalesRowSchema,
  monthlySalesSchema,
  reconciliationCheckSchema,
  tokenPairSchema,
  unitsSoldSchema,
} from "@/lib/api/schemas";

// Contract test: the frontend's runtime schemas must agree with the backend's OpenAPI
// document (generated from the NestJS DTOs). Renamed, removed or newly-required fields fail here.
const openapi = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../docs/openapi.json", import.meta.url)), "utf8"),
) as { components: { schemas: Record<string, { properties: Record<string, unknown>; required?: string[] }> } };

const pairs: [string, z.ZodObject][] = [
  ["MeDto", meSchema],
  ["MembershipDto", membershipSchema],
  ["TokenPairDto", tokenPairSchema],
  ["MonthlySalesResponseDto", monthlySalesSchema],
  ["MonthlySalesRowDto", monthlySalesRowSchema],
  ["UnitsSoldDto", unitsSoldSchema],
  ["ImportResultDto", importResultSchema],
  ["ImportStatsDto", importStatsSchema],
  ["ReconciliationCheckDto", reconciliationCheckSchema],
  ["ImportIssueDto", importIssueSchema],
  ["ImportBatchSummaryDto", importBatchSummarySchema],
  ["ImportBatchListDto", importBatchListSchema],
  ["ImportBatchDetailDto", importBatchDetailSchema],
];

describe("frontend schemas match the API OpenAPI contract", () => {
  it.each(pairs)("%s", (name, schema) => {
    const dto = openapi.components.schemas[name];
    expect(dto, `${name} missing from openapi.json`).toBeDefined();
    const apiProps = Object.keys(dto.properties).sort();
    const webProps = Object.keys(schema.shape).sort();
    expect(webProps).toEqual(apiProps);
    // Everything the API marks required must be required in the frontend schema too.
    for (const field of dto.required ?? []) {
      expect(schema.shape[field].safeParse(undefined).success, `${name}.${field} should be required`).toBe(false);
    }
  });
});
