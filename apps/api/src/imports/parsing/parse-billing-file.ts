import { readCsv, type CsvLimits } from './csv-reader.js';
import { mapHeaders } from './header-mapping.js';
import type { ImportIssue } from './issues.js';
import { normalizeRow, type NormalizedRow } from './row-normalizer.js';
import type { NumberFormat } from './value-parsers.js';
import { mapTemplateHeaders, type TemplateMapping } from './template-mapping.js';

export interface ParsedBillingFile {
  ok: boolean; // false = file-level failure, nothing should be imported
  rows: NormalizedRow[]; // valid, de-duplicated rows
  issues: ImportIssue[];
  stats: {
    rowsTotal: number;
    rowsValid: number;
    rowsInvalid: number;
    rowsDuplicateInFile: number;
  };
}

export const businessKey = (r: { billingDocument: string; billingItem: string }) =>
  `${r.billingDocument}/${r.billingItem}`;

/**
 * Pure pipeline stages 1-4: CSV -> header recognition -> type conversion/validation ->
 * in-file duplicate detection. No database access.
 *
 * Duplicate rule (SAP business key = billing document + item):
 *  - same key, identical content  -> keep the first row, count the rest as duplicates
 *  - same key, different content  -> reject ALL rows with that key (we cannot know which is right)
 */
export function parseBillingFile(
  buffer: Buffer,
  limits: CsvLimits,
  numberFormat: NumberFormat = 'PLAIN',
  template?: TemplateMapping,
): ParsedBillingFile {
  const empty = { rowsTotal: 0, rowsValid: 0, rowsInvalid: 0, rowsDuplicateInFile: 0 };
  const csv = readCsv(buffer, limits);
  if (!csv.ok) return { ok: false, rows: [], issues: csv.issues, stats: empty };

  const mapping = template ? mapTemplateHeaders(csv.headers, template) : mapHeaders(csv.headers);
  if (!mapping.ok) return { ok: false, rows: [], issues: mapping.issues, stats: empty };

  const issues: ImportIssue[] = [...mapping.issues];
  const candidates: NormalizedRow[] = [];
  let invalid = 0;

  csv.rows.forEach((cells, i) => {
    const r = normalizeRow(cells, mapping.columns, i + 2, template?.numberFormat ?? numberFormat, template);
    issues.push(...r.issues);
    if (r.row) candidates.push(r.row);
    else invalid++;
  });

  const byKey = new Map<string, NormalizedRow[]>();
  for (const row of candidates) {
    const k = businessKey(row);
    const list = byKey.get(k);
    if (list) list.push(row);
    else byKey.set(k, [row]);
  }

  const rows: NormalizedRow[] = [];
  let duplicates = 0;
  for (const [key, group] of byKey) {
    const hashes = new Set(group.map((r) => r.contentHash));
    if (hashes.size > 1) {
      invalid += group.length;
      for (const r of group) {
        issues.push({
          severity: 'error',
          code: 'CONFLICTING_DUPLICATE_KEY',
          line: r.line,
          message: `Billing document/item ${key} appears ${group.length} times with different values (lines ${group.map((g) => g.line).join(', ')}); all rejected.`,
        });
      }
      continue;
    }
    rows.push(group[0]);
    for (const dup of group.slice(1)) {
      duplicates++;
      issues.push({
        severity: 'info',
        code: 'DUPLICATE_ROW_IN_FILE',
        line: dup.line,
        message: `Exact duplicate of line ${group[0].line} (${key}); skipped.`,
      });
    }
  }
  rows.sort((a, b) => a.line - b.line);

  return {
    ok: true,
    rows,
    issues,
    stats: {
      rowsTotal: csv.rows.length,
      rowsValid: rows.length,
      rowsInvalid: invalid,
      rowsDuplicateInFile: duplicates,
    },
  };
}
