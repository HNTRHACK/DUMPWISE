import { parse } from 'csv-parse/sync';
import type { ImportIssue } from './issues.js';

export interface CsvLimits {
  maxBytes: number;
  maxRows: number;
}

export interface CsvReadResult {
  headers: string[];
  /** Data rows; rows[i] is source line i + 2 (line 1 is the header). */
  rows: string[][];
  issues: ImportIssue[];
  ok: boolean;
}

// Binary signatures of spreadsheet formats. These files are rejected, never opened:
// opening .xlsx/.xls/.xlsm is how macros and XML-bomb attacks get in.
const BINARY_SIGNATURES: { name: string; bytes: number[] }[] = [
  { name: 'ZIP/XLSX/XLSM', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { name: 'OLE2/XLS', bytes: [0xd0, 0xcf, 0x11, 0xe0] },
];

function fail(code: ImportIssue['code'], message: string): CsvReadResult {
  return { headers: [], rows: [], issues: [{ severity: 'error', code, message }], ok: false };
}

/**
 * Safely decodes and parses a CSV buffer.
 * - enforces byte and row limits before/while parsing
 * - accepts UTF-8 only (strict decode; invalid bytes are an error, not silently replaced)
 * - detects the delimiter deterministically from the header line (",", ";" or tab)
 * - never evaluates cell contents (no formulas, no macros)
 */
export function readCsv(buffer: Buffer, limits: CsvLimits): CsvReadResult {
  if (buffer.length === 0) return fail('FILE_EMPTY', 'File is empty.');
  if (buffer.length > limits.maxBytes) {
    return fail('FILE_TOO_LARGE', `File is ${buffer.length} bytes; limit is ${limits.maxBytes}.`);
  }
  for (const sig of BINARY_SIGNATURES) {
    if (sig.bytes.every((b, i) => buffer[i] === b)) {
      return fail(
        'UNSUPPORTED_FILE_TYPE',
        `File looks like a ${sig.name} spreadsheet. Only CSV exports are accepted; spreadsheets are never opened.`,
      );
    }
  }
  if (buffer.includes(0)) {
    return fail('UNSUPPORTED_FILE_TYPE', 'File contains NUL bytes; it is not a text CSV.');
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return fail('INVALID_ENCODING', 'File is not valid UTF-8. Export the report as UTF-8 CSV.');
  }
  text = text.replace(/^﻿/, '');

  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const candidates = [',', ';', '\t'].filter((d) => firstLine.includes(d));
  if (candidates.length !== 1) {
    return fail(
      'AMBIGUOUS_DELIMITER',
      candidates.length === 0
        ? 'Could not find a delimiter (comma, semicolon or tab) in the header line.'
        : `Header line contains several possible delimiters (${candidates.map((c) => JSON.stringify(c)).join(', ')}).`,
    );
  }

  let records: string[][];
  try {
    records = parse(text, {
      delimiter: candidates[0],
      relax_column_count: false,
      skip_empty_lines: true,
      max_record_size: 64 * 1024,
      // Stop after header + maxRows + 1 records: enough to detect "over the limit"
      // without materializing a huge file in memory.
      to: limits.maxRows + 2,
      bom: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail('CSV_PARSE_ERROR', `CSV could not be parsed: ${msg}`);
  }

  if (records.length === 0) return fail('FILE_EMPTY', 'File has no header row.');
  if (records.length - 1 > limits.maxRows) {
    return fail('TOO_MANY_ROWS', `File has more than ${limits.maxRows} data rows.`);
  }

  const [headers, ...rows] = records;
  return { headers, rows, issues: [], ok: true };
}
