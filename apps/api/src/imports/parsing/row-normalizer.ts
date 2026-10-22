import { createHash } from 'node:crypto';
import { applySignRules, isSupportedBillingType, type SupportedBillingType } from './billing-rules.js';
import type { CanonicalField } from './header-mapping.js';
import type { ImportIssue } from './issues.js';
import { alphaPad, parseSapDate, parseUnsignedDecimal, type NumberFormat } from './value-parsers.js';

export interface NormalizedRow {
  line: number;
  billingDate: string; // YYYY-MM-DD
  month: string; // YYYY-MM
  billingDocument: string;
  billingItem: string;
  billingType: SupportedBillingType;
  cancelledDocument: string | null;
  distributorCode: string;
  distributorName: string | null;
  sku: string;
  productDescription: string | null;
  customerCode: string;
  quantity: string; // signed, 3 dp
  salesUnit: string;
  netAmount: string; // signed, 2 dp
  currency: string;
  contentHash: string;
}

const CODE = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/;

export function normalizeRow(
  cells: string[],
  columns: Partial<Record<CanonicalField, number>>,
  line: number,
  numberFormat: NumberFormat,
): { row?: NormalizedRow; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const get = (f: CanonicalField): string => {
    const idx = columns[f];
    return idx === undefined ? '' : (cells[idx] ?? '').trim();
  };
  const error = (field: CanonicalField, code: ImportIssue['code'], message: string) =>
    issues.push({ severity: 'error', code, field, line, message });

  const required = (field: CanonicalField): string => {
    const v = get(field);
    if (v === '') error(field, 'REQUIRED_VALUE_MISSING', `${field} is empty.`);
    return v;
  };
  const code = (field: CanonicalField, maxLen: number, padTo?: number): string => {
    const v = required(field);
    if (v === '') return v;
    if (v.length > maxLen || !CODE.test(v)) {
      error(field, 'INVALID_FORMAT', `${field} "${v}" is not a valid identifier (max ${maxLen} chars).`);
      return v;
    }
    return padTo ? alphaPad(v, padTo) : v;
  };
  const optionalText = (field: CanonicalField): string | null => {
    const v = get(field);
    return v === '' ? null : v.slice(0, 200);
  };

  // Identifiers stay strings. Numeric document/item/partner numbers get SAP ALPHA padding
  // so "90000908" and "0090000908" are recognized as the same document.
  const billingDocument = code('billingDocument', 20, 10);
  const billingItem = code('billingItem', 6, 6);
  const distributorCode = code('distributorCode', 20, 10);
  const customerCode = code('customerCode', 20, 10);
  const sku = code('sku', 40);

  const typeRaw = required('billingType').toUpperCase();
  if (typeRaw !== '' && !isSupportedBillingType(typeRaw)) {
    error('billingType', 'UNSUPPORTED_BILLING_TYPE', `Billing type "${typeRaw}" is not supported (F2, G2, RE, S1).`);
  }

  let billingDate = '';
  const dateRaw = required('billingDate');
  if (dateRaw !== '') {
    const r = parseSapDate(dateRaw);
    if (r.ok) billingDate = r.value;
    else error('billingDate', r.code, r.message);
  }

  let qty = '';
  const qtyRaw = required('quantity');
  if (qtyRaw !== '') {
    const r = parseUnsignedDecimal(qtyRaw, 3, numberFormat);
    if (r.ok) qty = r.value;
    else error('quantity', r.code, r.message);
  }

  let amount = '';
  const amountRaw = required('netAmount');
  if (amountRaw !== '') {
    const r = parseUnsignedDecimal(amountRaw, 2, numberFormat);
    if (r.ok) amount = r.value;
    else error('netAmount', r.code, r.message);
  }

  const currency = required('currency').toUpperCase();
  if (currency !== '' && !/^[A-Z]{3}$/.test(currency)) {
    error('currency', 'INVALID_FORMAT', `Currency "${currency}" is not an ISO 4217 code.`);
  }
  const salesUnit = required('salesUnit').toUpperCase();
  if (salesUnit !== '' && !/^[A-Z0-9]{1,10}$/.test(salesUnit)) {
    error('salesUnit', 'INVALID_FORMAT', `Sales unit "${salesUnit}" is not valid.`);
  }

  const cancelledRaw = get('cancelledDocument');
  const cancelledDocument = cancelledRaw === '' ? null : alphaPad(cancelledRaw, 10);
  if (typeRaw === 'S1' && cancelledDocument === null) {
    error('cancelledDocument', 'MISSING_CANCELLATION_REFERENCE', 'Cancellation (S1) must reference the cancelled billing document.');
  }

  if (issues.length > 0 || !isSupportedBillingType(typeRaw)) return { issues };

  const signed = applySignRules(typeRaw, amount, qty);
  // The hash covers the business content of the row (not descriptive names), so a
  // re-export of the same SAP item produces the same hash.
  const contentHash = createHash('sha256')
    .update(
      JSON.stringify([
        billingDocument, billingItem, typeRaw, billingDate, distributorCode, sku, customerCode,
        signed.quantity, salesUnit, signed.netAmount, currency, cancelledDocument,
      ]),
    )
    .digest('hex');

  return {
    issues,
    row: {
      line,
      billingDate,
      month: billingDate.slice(0, 7),
      billingDocument,
      billingItem,
      billingType: typeRaw,
      cancelledDocument,
      distributorCode,
      distributorName: optionalText('distributorName'),
      sku,
      productDescription: optionalText('productDescription'),
      customerCode,
      quantity: signed.quantity,
      salesUnit,
      netAmount: signed.netAmount,
      currency,
      contentHash,
    },
  };
}
