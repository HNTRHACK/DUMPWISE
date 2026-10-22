import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Decimal } from 'decimal.js';
import { applySignRules } from './billing-rules.js';
import { mapHeaders } from './header-mapping.js';
import { parseBillingFile } from './parse-billing-file.js';
import { parseSapDate, parseUnsignedDecimal } from './value-parsers.js';

const LIMITS = { maxBytes: 20 * 1024 * 1024, maxRows: 200_000 };
const HEADER =
  'Billing Date,Billing Document,Item,Billing Type,Sold-To Party,Material,Ship-To Party,Billed Quantity,Sales Unit,Net Value,Doc. Currency,Cancelled Bill. Doc.';
const csv = (...rows: string[]) => Buffer.from([HEADER, ...rows].join('\n'), 'utf8');
const row = (o: Partial<Record<string, string>> = {}) =>
  [
    o.date ?? '10.09.2026',
    o.doc ?? '0090000001',
    o.item ?? '000010',
    o.type ?? 'F2',
    o.dist ?? '0000100001',
    o.sku ?? 'SYN-MAT-0001',
    o.cust ?? '0000200001',
    o.qty ?? '10',
    o.unit ?? 'EA',
    o.amount ?? '1000.00',
    o.cur ?? 'INR',
    o.cancelled ?? '',
  ].join(',');

describe('header recognition', () => {
  it('maps SAP labels and technical names deterministically', () => {
    const m = mapHeaders(['FKDAT', 'VBELN', 'POSNR', 'FKART', 'KUNAG', 'MATNR', 'KUNWE', 'FKIMG', 'VRKME', 'NETWR', 'WAERK']);
    expect(m.ok).toBe(true);
    expect(m.columns.netAmount).toBe(9);
  });

  it('never maps an ambiguous "Amount" column to net value', () => {
    const m = mapHeaders(HEADER.replace('Net Value', 'Amount').split(','));
    expect(m.ok).toBe(false);
    expect(m.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['AMBIGUOUS_COLUMN_IGNORED', 'MISSING_REQUIRED_COLUMN']),
    );
  });

  it('rejects two columns that map to the same field', () => {
    const m = mapHeaders([...HEADER.split(','), 'NETWR']);
    expect(m.ok).toBe(false);
    expect(m.issues[0].code).toBe('DUPLICATE_COLUMN_MAPPING');
  });
});

describe('invalid date and quantity', () => {
  it.each([
    ['31.02.2026', 'INVALID_DATE'],
    ['03/05/2026', 'AMBIGUOUS_DATE_FORMAT'],
    ['2026-13-01', 'INVALID_DATE'],
    ['yesterday', 'INVALID_DATE'],
  ])('rejects date %s', (raw, code) => {
    const r = parseSapDate(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });

  it('accepts SAP dotted and ISO dates', () => {
    expect(parseSapDate('29.02.2024')).toEqual({ ok: true, value: '2024-02-29' });
    expect(parseSapDate('2026-09-30')).toEqual({ ok: true, value: '2026-09-30' });
  });

  it.each([
    ['12a', 'INVALID_NUMBER'],
    ['-5', 'NEGATIVE_VALUE'],
    ['1.2345', 'TOO_MANY_DECIMALS'],
    ['1,234', 'INVALID_NUMBER'],
  ])('rejects quantity %s', (raw, code) => {
    const r = parseUnsignedDecimal(raw, 3, 'PLAIN');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });

  it('accepts Indian and international grouping only when declared', () => {
    expect(parseUnsignedDecimal('1,23,456.78', 2, 'EN_GROUPED')).toEqual({ ok: true, value: '123456.78' });
    expect(parseUnsignedDecimal('1,234,567.8', 2, 'EN_GROUPED')).toEqual({ ok: true, value: '1234567.8' });
    expect(parseUnsignedDecimal('1,2,3', 2, 'EN_GROUPED').ok).toBe(false);
  });

  it('rejects the row and keeps the line number', () => {
    const r = parseBillingFile(csv(row(), row({ doc: '0090000002', date: '31.02.2026', qty: 'abc' })), LIMITS);
    expect(r.stats).toMatchObject({ rowsTotal: 2, rowsValid: 1, rowsInvalid: 1 });
    expect(r.issues.filter((i) => i.severity === 'error').map((i) => [i.line, i.field])).toEqual([
      [3, 'billingDate'],
      [3, 'quantity'],
    ]);
  });
});

describe('duplicate detection', () => {
  it('skips exact duplicates and rejects conflicting duplicates', () => {
    const r = parseBillingFile(
      csv(
        row(),
        row(), // exact duplicate
        row({ doc: '90000002' }), // same as 0090000002 after ALPHA padding
        row({ doc: '0090000002', amount: '999.00' }), // conflict
        row({ doc: '0090000003' }),
      ),
      LIMITS,
    );
    expect(r.stats).toEqual({ rowsTotal: 5, rowsValid: 2, rowsInvalid: 2, rowsDuplicateInFile: 1 });
    expect(r.rows.map((x) => x.billingDocument)).toEqual(['0090000001', '0090000003']);
    expect(r.issues.filter((i) => i.code === 'CONFLICTING_DUPLICATE_KEY')).toHaveLength(2);
  });

  it('preserves leading zeros in SAP identifiers', () => {
    const r = parseBillingFile(csv(row({ sku: '000000000000010001' })), LIMITS);
    expect(r.rows[0].sku).toBe('000000000000010001');
    expect(r.rows[0].billingItem).toBe('000010');
  });
});

describe('credit note calculations', () => {
  it('applies documented sign rules', () => {
    expect(applySignRules('F2', '1000.00', '10')).toEqual({ netAmount: '1000.00', quantity: '10.000' });
    expect(applySignRules('G2', '50.00', '10')).toEqual({ netAmount: '-50.00', quantity: '0.000' });
    expect(applySignRules('RE', '250.00', '2.5')).toEqual({ netAmount: '-250.00', quantity: '-2.500' });
    expect(applySignRules('S1', '1000.00', '10')).toEqual({ netAmount: '-1000.00', quantity: '-10.000' });
  });

  it('nets an invoice, credit memo, return and cancellation exactly', () => {
    const r = parseBillingFile(
      csv(
        row({ doc: '0090000001', amount: '1000.10', qty: '10' }),
        row({ doc: '0090000002', amount: '500.20', qty: '5' }),
        row({ doc: '0070000001', type: 'G2', amount: '0.30', qty: '10' }),
        row({ doc: '0060000001', type: 'RE', amount: '100.01', qty: '1' }),
        row({ doc: '0080000001', type: 'S1', amount: '500.20', qty: '5', cancelled: '0090000002' }),
      ),
      LIMITS,
    );
    const net = r.rows.reduce((s, x) => s.plus(x.netAmount), new Decimal(0));
    const units = r.rows.reduce((s, x) => s.plus(x.quantity), new Decimal(0));
    expect(net.toFixed(2)).toBe('899.79'); // 1000.10 + 500.20 - 0.30 - 100.01 - 500.20
    expect(units.toFixed(3)).toBe('9.000'); // 10 + 5 + 0 - 1 - 5
  });

  it('requires a reference on cancellations and rejects unknown billing types', () => {
    const r = parseBillingFile(csv(row({ type: 'S1' }), row({ doc: '2', type: 'ZF2' })), LIMITS);
    expect(r.issues.map((i) => i.code)).toEqual(['MISSING_CANCELLATION_REFERENCE', 'UNSUPPORTED_BILLING_TYPE']);
  });
});

describe('unsafe files', () => {
  it('rejects spreadsheets without opening them', () => {
    const xlsx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
    expect(parseBillingFile(xlsx, LIMITS).issues[0].code).toBe('UNSUPPORTED_FILE_TYPE');
  });
  it('enforces size and row limits', () => {
    expect(parseBillingFile(csv(row()), { maxBytes: 10, maxRows: 10 }).issues[0].code).toBe('FILE_TOO_LARGE');
    expect(parseBillingFile(csv(row(), row({ doc: '2' })), { ...LIMITS, maxRows: 1 }).issues[0].code).toBe('TOO_MANY_ROWS');
  });
  it('rejects invalid UTF-8', () => {
    const bad = Buffer.concat([Buffer.from(HEADER + '\n'), Buffer.from([0xff, 0xfe, 0x41])]);
    expect(parseBillingFile(bad, LIMITS).issues[0].code).toBe('INVALID_ENCODING');
  });
});

describe('synthetic dataset', () => {
  it('produces exactly the issue counts the independent generator expects', () => {
    const dir = resolve(process.cwd(), '../../data/synthetic');
    const stem = 'SYNTHETIC_sap_billing_2025-10_to_2026-09';
    const expected = JSON.parse(readFileSync(`${dir}/${stem}.control_totals.json`, 'utf8')).expectedIssues;
    const r = parseBillingFile(readFileSync(`${dir}/${stem}.csv`), LIMITS);
    expect(r.ok).toBe(true);
    expect(r.stats.rowsValid).toBe(expected.validUniqueRows);
    expect(r.stats.rowsDuplicateInFile).toBe(expected.exactDuplicateRows);
    expect(r.stats.rowsInvalid).toBe(expected.invalidRows + expected.conflictingKeyRows);
  });
});
