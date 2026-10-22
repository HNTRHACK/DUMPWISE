import type { ImportIssue } from './issues.js';

// Deterministic header recognition. A column is mapped ONLY if its normalized header
// exactly matches a known SAP label or technical field name. No fuzzy matching, no AI.

export type CanonicalField =
  | 'billingDate'
  | 'billingDocument'
  | 'billingItem'
  | 'billingType'
  | 'distributorCode'
  | 'distributorName'
  | 'sku'
  | 'productDescription'
  | 'customerCode'
  | 'quantity'
  | 'salesUnit'
  | 'netAmount'
  | 'currency'
  | 'cancelledDocument';

interface FieldSpec {
  required: boolean;
  aliases: string[]; // SAP UI labels + SAP technical field names
}

export const FIELD_SPECS: Record<CanonicalField, FieldSpec> = {
  billingDate: { required: true, aliases: ['billing date', 'fkdat', 'bill date'] },
  billingDocument: {
    required: true,
    aliases: ['billing document', 'billing doc', 'bill doc', 'vbeln'],
  },
  billingItem: { required: true, aliases: ['item', 'billing item', 'posnr'] },
  billingType: { required: true, aliases: ['billing type', 'bill type', 'fkart'] },
  distributorCode: { required: true, aliases: ['sold to party', 'sold to', 'kunag'] },
  distributorName: { required: false, aliases: ['sold to name', 'name of sold to party'] },
  sku: { required: true, aliases: ['material', 'material number', 'matnr'] },
  productDescription: {
    required: false,
    aliases: ['material description', 'arktx'],
  },
  customerCode: { required: true, aliases: ['ship to party', 'ship to', 'kunwe'] },
  quantity: { required: true, aliases: ['billed quantity', 'billed qty', 'fkimg'] },
  salesUnit: { required: true, aliases: ['sales unit', 'vrkme'] },
  netAmount: {
    required: true,
    aliases: ['net value', 'net value in document currency', 'netwr'],
  },
  currency: {
    required: true,
    aliases: ['doc currency', 'document currency', 'waerk'],
  },
  cancelledDocument: {
    required: false,
    aliases: ['cancelled bill doc', 'cancelled billing document', 'sfakn'],
  },
};

// Headers that look like money/quantity/currency/date but do not say WHICH one
// (gross or net? local or document currency? base or sales unit?). They are never mapped.
const AMBIGUOUS_HEADERS = new Set([
  'amount',
  'value',
  'total',
  'price',
  'gross value',
  'qty',
  'quantity',
  'currency',
  'curr',
  'date',
  'unit',
  'uom',
]);

export function normalizeHeader(h: string): string {
  return h
    .replace(/^﻿/, '')
    .toLowerCase()
    .replace(/[._\-/()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ALIAS_INDEX = new Map<string, CanonicalField>();
for (const [field, spec] of Object.entries(FIELD_SPECS) as [CanonicalField, FieldSpec][]) {
  for (const alias of spec.aliases) ALIAS_INDEX.set(normalizeHeader(alias), field);
}

export interface HeaderMapping {
  /** canonical field -> column index */
  columns: Partial<Record<CanonicalField, number>>;
  issues: ImportIssue[];
  ok: boolean;
}

export function mapHeaders(headers: string[]): HeaderMapping {
  const columns: Partial<Record<CanonicalField, number>> = {};
  const issues: ImportIssue[] = [];
  const ambiguousSeen: string[] = [];

  headers.forEach((raw, index) => {
    const norm = normalizeHeader(raw);
    const field = ALIAS_INDEX.get(norm);
    if (field) {
      if (columns[field] !== undefined) {
        issues.push({
          severity: 'error',
          code: 'DUPLICATE_COLUMN_MAPPING',
          field,
          message: `Columns "${headers[columns[field]]}" and "${raw}" both map to ${field}; refusing to guess which one is correct.`,
        });
      } else {
        columns[field] = index;
      }
    } else if (AMBIGUOUS_HEADERS.has(norm)) {
      ambiguousSeen.push(raw);
      issues.push({
        severity: 'warning',
        code: 'AMBIGUOUS_COLUMN_IGNORED',
        message: `Column "${raw}" is ambiguous and was not used. Rename it to an SAP label such as "Net Value", "Billed Quantity" or "Doc. Currency".`,
      });
    } else if (norm !== '') {
      issues.push({
        severity: 'warning',
        code: 'UNKNOWN_COLUMN_IGNORED',
        message: `Column "${raw}" is not recognized and was ignored.`,
      });
    }
  });

  for (const [field, spec] of Object.entries(FIELD_SPECS) as [CanonicalField, FieldSpec][]) {
    if (spec.required && columns[field] === undefined) {
      const hint = ambiguousSeen.length
        ? ` Ambiguous columns present: ${ambiguousSeen.map((a) => `"${a}"`).join(', ')}.`
        : '';
      issues.push({
        severity: 'error',
        code: 'MISSING_REQUIRED_COLUMN',
        field,
        message: `Required column for ${field} not found. Accepted headers: ${spec.aliases.join(', ')}.${hint}`,
      });
    }
  }

  return { columns, issues, ok: !issues.some((i) => i.severity === 'error') };
}
