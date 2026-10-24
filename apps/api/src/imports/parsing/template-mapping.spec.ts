import { describe, it, expect } from 'vitest';
import { FIELD_SPECS } from './header-mapping.js';
import { templateMappingSchema, type TemplateMapping } from './template-mapping.js';
import { parseBillingFile } from './parse-billing-file.js';

const mapping: TemplateMapping = {
  columns: Object.entries(FIELD_SPECS).filter(([, v]) => v.required).map(([field]) => ({
    field: field as TemplateMapping['columns'][number]['field'], header: field,
  })),
  dateFormat: 'DD/MM/YYYY', numberFormat: 'PLAIN', documentTypes: { F2: 'F2', G2: 'G2', ZRET: 'RE' },
};
const values: Record<string, string> = { billingDate: '03/05/2026', billingDocument: '001',
  billingItem: '10', billingType: 'F2', distributorCode: '123', customerCode: '456', sku: 'SYN-SKU',
  quantity: '2.000', salesUnit: 'EA', netAmount: '10.25', currency: 'INR' };
function csv(overrides: Record<string, string> = {}, duplicate = false) {
  const row = mapping.columns.map((c) => ({ ...values, ...overrides })[c.field]).join(',');
  return Buffer.from(mapping.columns.map((c) => c.header).join(',') + '\n' + row + '\n' + (duplicate ? row + '\n' : ''));
}
const limits = { maxBytes: 10000, maxRows: 100 };

describe('explicit immutable mapping language', () => {
  it('requires all canonical fields, unique headers, known transforms and fixed SAP meanings', () => {
    expect(templateMappingSchema.safeParse(mapping).success).toBe(true);
    for (const invalid of [
      { ...mapping, columns: mapping.columns.slice(1) },
      { ...mapping, columns: mapping.columns.map((c) => ({ ...c, header: 'Amount' })) },
      { ...mapping, expression: 'process.exit()' },
      { ...mapping, documentTypes: { F2: 'G2' } },
      { ...mapping, documentTypes: { L2: 'L2' } },
      { ...mapping, dateFormat: 'AUTO' },
    ]) expect(templateMappingSchema.safeParse(invalid).success).toBe(false);
  });

  it('is deterministic, preserves identifiers, counts duplicates and requires explicit date order', () => {
    const a = parseBillingFile(csv({}, true), limits, 'PLAIN', mapping);
    expect(a).toEqual(parseBillingFile(csv({}, true), limits, 'PLAIN', mapping));
    expect(a.rows[0]).toMatchObject({ billingDate: '2026-05-03', billingDocument: '0000000001', netAmount: '10.25', quantity: '2.000' });
    expect(a.stats.rowsDuplicateInFile).toBe(1);
    const us = parseBillingFile(csv(), limits, 'PLAIN', { ...mapping, dateFormat: 'MM/DD/YYYY' });
    expect(us.rows[0].billingDate).toBe('2026-03-05');
    expect(parseBillingFile(csv({ billingDate: '2026-05-03' }), limits, 'PLAIN', mapping).stats.rowsInvalid).toBe(1);
    expect(parseBillingFile(csv({ billingDate: '31/02/2026' }), limits, 'PLAIN', mapping).stats.rowsInvalid).toBe(1);
  });

  it('reuses sign rules for credit and reviewed aliases; rejects unknown types and ambiguous amounts', () => {
    expect(parseBillingFile(csv({ billingType: 'G2' }), limits, 'PLAIN', mapping).rows[0]).toMatchObject({ netAmount: '-10.25', quantity: '0.000' });
    expect(parseBillingFile(csv({ billingType: 'ZRET' }), limits, 'PLAIN', mapping).rows[0]).toMatchObject({ billingType: 'RE', netAmount: '-10.25', quantity: '-2.000' });
    for (const changes of [{ billingType: 'RE' }, { netAmount: '-10' }, { netAmount: '10,25' }] as Record<string, string>[]) {
      expect(parseBillingFile(csv(changes), limits, 'PLAIN', mapping).rows).toHaveLength(0);
    }
    const dupHeader = Buffer.from(csv().toString().replace('billingDate,billingDocument', 'billingDate,billingDate'));
    expect(parseBillingFile(dupHeader, limits, 'PLAIN', mapping).ok).toBe(false);
  });
});
