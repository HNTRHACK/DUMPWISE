import { z } from 'zod';
import { FIELD_SPECS, normalizeHeader, type CanonicalField, type HeaderMapping } from './header-mapping.js';

export const BILLING_RULES_VERSION = 'sap-billing-signs-v1';
const fields = Object.keys(FIELD_SPECS) as [CanonicalField, ...CanonicalField[]];

/** A small declarative language: no expressions, defaults, sign overrides or executable code. */
export const templateMappingSchema = z.strictObject({
  columns: z.array(z.strictObject({
    field: z.enum(fields),
    header: z.string().trim().min(1).max(120).refine((s) => !Array.from(s).some(c => c.charCodeAt(0) < 32)),
  })).min(1).max(fields.length),
  dateFormat: z.enum(['YYYY-MM-DD', 'DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY']),
  numberFormat: z.enum(['PLAIN', 'EN_GROUPED']),
  documentTypes: z.record(z.string().regex(/^[A-Z0-9]{1,8}$/), z.enum(['F2', 'G2', 'RE', 'S1']))
    .refine((v) => Object.keys(v).length > 0 && Object.keys(v).length <= 20, 'Select 1-20 document types'),
}).superRefine((v, ctx) => {
  const seenFields = new Set<string>();
  const seenHeaders = new Set<string>();
  for (const c of v.columns) {
    const header = normalizeHeader(c.header);
    if (!header || seenFields.has(c.field) || seenHeaders.has(header)) {
      ctx.addIssue({ code: 'custom', message: 'Canonical fields and normalized source headers must be unique' });
    }
    seenFields.add(c.field);
    seenHeaders.add(header);
  }
  for (const [field, spec] of Object.entries(FIELD_SPECS)) {
    if (spec.required && !seenFields.has(field)) ctx.addIssue({ code: 'custom', message: `Missing required mapping: ${field}` });
  }
  // A known SAP type cannot be redefined to a different financial meaning.
  for (const type of ['F2', 'G2', 'RE', 'S1']) {
    if (Object.hasOwn(v.documentTypes, type) && v.documentTypes[type] !== type) {
      ctx.addIssue({ code: 'custom', message: `Cannot redefine fixed billing type ${type}` });
    }
  }
});

export type TemplateMapping = z.infer<typeof templateMappingSchema>;

export function mapTemplateHeaders(headers: string[], template: TemplateMapping): HeaderMapping {
  const columns: HeaderMapping['columns'] = {};
  const issues: HeaderMapping['issues'] = [];
  for (const c of template.columns) {
    const matches = headers.flatMap((header, i) => normalizeHeader(header) === normalizeHeader(c.header) ? [i] : []);
    if (matches.length === 1) columns[c.field] = matches[0];
    else if (matches.length > 1 || FIELD_SPECS[c.field].required) issues.push({
      severity: 'error', field: c.field,
      code: matches.length > 1 ? 'DUPLICATE_COLUMN_MAPPING' : 'MISSING_REQUIRED_COLUMN',
      message: `Expected one source column "${c.header}" for ${c.field}; found ${matches.length}.`,
    });
  }
  return { columns, issues, ok: issues.length === 0 };
}

export function explainMapping(template: TemplateMapping) {
  return template.columns.map((c) => ({
    ...c, required: FIELD_SPECS[c.field].required,
    interpretation: c.field === 'billingDate' ? template.dateFormat
      : c.field === 'netAmount' ? `Unsigned amount; ${template.numberFormat}; max 2 decimals; sign from ${BILLING_RULES_VERSION}`
      : c.field === 'quantity' ? `Unsigned quantity; ${template.numberFormat}; max 3 decimals; G2 quantity becomes zero`
      : c.field === 'billingType' ? JSON.stringify(template.documentTypes)
      : c.field === 'currency' || c.field === 'salesUnit' ? 'Required explicit source value, uppercase, no conversion or default'
      : 'Source text; existing canonical identifier and length rules apply',
  }));
}
