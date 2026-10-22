// Strict, deterministic parsers for SAP export values. Each returns either a normalized
// value or an error description; nothing is guessed.

export type NumberFormat = 'PLAIN' | 'EN_GROUPED';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; code: ParseErrorCode; message: string };
export type ParseErrorCode =
  | 'INVALID_DATE'
  | 'AMBIGUOUS_DATE_FORMAT'
  | 'INVALID_NUMBER'
  | 'NEGATIVE_VALUE'
  | 'TOO_MANY_DECIMALS';

const ok = <T>(value: T): ParseResult<T> => ({ ok: true, value });
const err = <T>(code: ParseErrorCode, message: string): ParseResult<T> => ({
  ok: false,
  code,
  message,
});

/**
 * Accepts DD.MM.YYYY (SAP dotted format) and YYYY-MM-DD (ISO).
 * Slash dates are rejected: "03/05/2026" is 3 May in India and 5 March in the US.
 * Returns ISO "YYYY-MM-DD".
 */
export function parseSapDate(raw: string): ParseResult<string> {
  let y: number, m: number, d: number;
  let match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw);
  if (match) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if (/^\d{1,4}[/]\d{1,2}[/]\d{1,4}$/.test(raw)) {
    return err('AMBIGUOUS_DATE_FORMAT', `Date "${raw}" uses slashes; day/month order is ambiguous. Use DD.MM.YYYY or YYYY-MM-DD.`);
  } else {
    return err('INVALID_DATE', `Date "${raw}" is not in DD.MM.YYYY or YYYY-MM-DD format.`);
  }
  if (y < 2000 || y > 2100) return err('INVALID_DATE', `Date "${raw}" has an implausible year.`);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return err('INVALID_DATE', `Date "${raw}" does not exist in the calendar.`);
  }
  return ok(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
}

const PLAIN = /^\d+(\.\d+)?$/;
// 1,234,567.89 (international) or 12,34,567.89 (Indian lakh/crore grouping)
const EN_GROUPED = /^(\d{1,3}(,\d{3})+|\d{1,2}(,\d{2})*,\d{3}|\d+)(\.\d+)?$/;

/**
 * Parses a non-negative decimal string. In SAP billing exports the sign of a value is
 * determined by the billing type, so an explicit minus sign is treated as an error
 * instead of being silently combined with the billing-type sign.
 * Returns a canonical decimal string (no grouping, no leading "+").
 */
export function parseUnsignedDecimal(
  raw: string,
  maxDecimals: number,
  format: NumberFormat,
): ParseResult<string> {
  // SAP sometimes writes negatives with a trailing minus ("5-").
  if (raw.trimStart().startsWith('-') || raw.endsWith('-')) {
    return err('NEGATIVE_VALUE', `Value "${raw}" is negative; signs are derived from the billing type, so export values must be unsigned.`);
  }
  const pattern = format === 'PLAIN' ? PLAIN : EN_GROUPED;
  if (!pattern.test(raw)) {
    const hint = format === 'PLAIN' && raw.includes(',') ? ' (grouping commas are not allowed in PLAIN number format)' : '';
    return err('INVALID_NUMBER', `Value "${raw}" is not a valid number${hint}.`);
  }
  const canonical = raw.replace(/,/g, '');
  const [intPart, frac = ''] = canonical.split('.');
  if (frac.length > maxDecimals) {
    return err('TOO_MANY_DECIMALS', `Value "${raw}" has more than ${maxDecimals} decimal places.`);
  }
  if (intPart.replace(/^0+(?=\d)/, '').length > 15) {
    return err('INVALID_NUMBER', `Value "${raw}" is too large.`);
  }
  return ok(frac ? `${intPart}.${frac}` : intPart);
}

/** SAP ALPHA conversion for purely numeric keys: pad with leading zeros to the field length. */
export function alphaPad(raw: string, length: number): string {
  return /^\d+$/.test(raw) && raw.length < length ? raw.padStart(length, '0') : raw;
}
