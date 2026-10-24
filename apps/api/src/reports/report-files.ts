import ExcelJS from 'exceljs';
import pptxgen from 'pptxgenjs';
import JSZip from 'jszip';
import type { ReportSnapshotData, ReportGroup } from './report-snapshot.js';

// PptxGenJS's CommonJS declarations wrap the default under NodeNext; its ESM runtime exports the class.
const PptxGenJS = pptxgen as unknown as typeof pptxgen.default;

// Force all source text to a text cell, including after whitespace/control prefixes.
export function spreadsheetText(value: string): string {
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  // eslint-disable-next-line no-control-regex -- include hidden prefixes in injection detection
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
}

export async function reportFiles(s: ReportSnapshotData) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DUMPWISE'; wb.created = new Date(s.generatedAt);
  const sheet = (name: string, headers: string[], rows: (string | number)[][]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(headers);
    rows.forEach(row => ws.addRow(row.map(v => typeof v === 'string' ? spreadsheetText(v) : v)));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF432D27' } };
    ws.getRow(1).height = 26;
    ws.columns.forEach((c, i) => { c.width = i === 0 ? 30 : 24; });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, ws.rowCount), column: headers.length } };
    ws.eachRow((row, n) => {
      row.alignment = { vertical: 'top', wrapText: true };
      if (n > 1 && n % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F1E9' } };
    });
    return ws;
  };
  sheet('Report', ['Definition', 'Value'], [
    ['Organization', s.organizationName], ['Organization ID', s.organizationId], ['Classification', s.classification],
    ['Generated UTC', s.generatedAt], ['Period', `${s.from} through ${s.to}`], ['Currency', s.currency],
    ['Unit filter', s.unit ?? 'All units, separate'], ['Definition version', s.definitionVersion], ['Metric version', s.metricVersion],
    ['Net revenue', s.netRevenue], ['Credits (already deducted)', s.credits], ['Returns (already deducted)', s.returns],
    ['Cancellations (already deducted)', s.cancellations], ['Billing line items', s.transactionCount],
    ['Exact decimal policy', 'Money and quantities are decimal TEXT to preserve all source digits. No financial value is converted through binary floating point.'],
    ['Comparison', `${s.previousFrom} through ${s.previousTo}; growth needs every month and positive prior net revenue`],
    ['Coverage', s.coverageNote], ['Format', 'Generic DUMPWISE management report; no company workbook compatibility asserted'],
  ]);
  sheet('Monthly sales', ['Month', `Net revenue (${s.currency}, exact text)`, 'Billing line items'], s.months.map(m => [m.month, m.netRevenue, m.lines]));
  sheet('Quantities', ['Unit', 'Net quantity (exact text)'], s.units.map(u => [u.unit, u.quantity]));
  const rankings = (name: string, rows: ReportGroup[]) => sheet(name,
    ['Code', 'Unit', 'Net revenue', 'Credit reduction', 'Return reduction', 'Cancellation reduction', 'Net quantity', 'Line items', 'Previous revenue', 'Growth %', 'Growth limitation'],
    rows.map(r => [r.code, r.unit, r.netRevenue, r.credits, r.returns, r.cancellations, r.quantity, r.lines, r.previousRevenue, r.growthPercent ?? '', r.growthReason ?? '']));
  rankings('SKU rankings', s.products); rankings('Distributors', s.distributors); rankings('Customers', s.customers);
  sheet('Transactions', ['Transaction UUID', 'Date', 'SAP document', 'Item', 'Type', 'SKU', 'Sold-to', 'Ship-to', 'Net amount', 'Currency', 'Quantity', 'Unit', 'Batch UUID', 'Source line', 'Template UUID', 'Rules version'],
    s.transactions.map(t => [t.id, t.date, t.document, t.item, t.type, t.sku, t.distributor, t.customer, t.amount, t.currency, t.quantity, t.unit, t.batchId, t.line, t.templateVersionId ?? 'Legacy aliases', t.rulesVersion]));
  sheet('Source coverage', ['Batch UUID', 'File name', 'SHA-256', 'Published UTC', 'Accepted rows', 'Rejected rows', 'Duplicate rows', 'Inserted rows', 'Template UUID', 'Rules', 'Original file'],
    s.sources.map(b => [b.id, b.fileName, b.sha256, b.publishedAt, b.accepted, b.rejected, b.duplicates, b.inserted, b.templateVersionId ?? 'Legacy aliases', b.rulesVersion, 'NOT RETAINED']));
  sheet('Reconciliation', ['Batch UUID', 'Metric', 'Month', 'Currency', 'Unit', 'Expected (exact text)', 'Actual (exact text)', 'Passed'],
    s.sources.flatMap(b => b.checks.map(c => [b.id, c.metric, c.month, c.currency ?? '', c.unit ?? '', c.expected, c.actual, c.passed ? 'YES' : 'NO'])));

  const ppt = new PptxGenJS(); ppt.layout = 'LAYOUT_WIDE'; ppt.author = 'DUMPWISE';
  ppt.subject = 'Reconciled management report'; ppt.title = `DUMPWISE ${s.from} to ${s.to} ${s.currency}`;
  ppt.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos' };
  ppt.defineSlideMaster({ title: 'DUMPWISE', background: { color: 'F6F1E9' }, objects: [
    { text: { text: 'DUMPWISE', options: { x: 0.55, y: 0.2, w: 4, h: 0.35, color: '432D27', fontSize: 16, bold: true } } },
    { text: { text: `${s.currency} | ${s.from} to ${s.to} | ${s.classification} | ${s.metricVersion}`, options: { x: 0.55, y: 7.0, w: 12.2, h: 0.25, fontSize: 10, color: '655D57' } } },
  ], slideNumber: { x: 12.3, y: 7.0, color: '655D57', fontSize: 10 } });
  const slide = (title: string) => {
    const p = ppt.addSlide('DUMPWISE');
    p.addText(title, { x: 0.55, y: 0.8, w: 12.2, h: 0.65, fontSize: 30, bold: true, color: '432D27', breakLine: false });
    p.addNotes(`Organization ${s.organizationId}. Generated ${s.generatedAt}. ${s.definitionVersion}. Exact values from immutable report snapshot. ${s.coverageNote}`);
    return p;
  };
  const table = (title: string, headers: string[], rows: string[][]) => {
    const p = slide(title);
    p.addTable([headers.map(text => ({ text, options: { bold: true, color: 'FFFFFF', fill: { color: '432D27' } } })), ...rows.map(row => row.map(text => ({ text })))],
      { x: 0.55, y: 1.65, w: 12.2, fontSize: 15, color: '432D27', border: { color: 'D9CEC1', pt: 0.5 },
        margin: 0.07, rowH: 0.34, autoPage: false, valign: 'middle' });
    return p;
  };
  const cover = slide('Reconciled management report');
  cover.addText(`${s.organizationName}\n${s.from} through ${s.to}\n${s.currency} | ${s.unit ?? 'Separate physical units'}\nGenerated ${s.generatedAt}`, { x: 0.55, y: 2, w: 12.2, h: 2, fontSize: 23, color: '432D27', breakLine: false });
  cover.addText(s.classification === 'SYNTHETIC' ? 'SYNTHETIC DEMONSTRATION — no real company results' : 'Published, reconciled source facts', { x: 0.55, y: 5, w: 12.2, h: 0.8, fontSize: 20, color: '9B4C23' });
  table('Sales summary', ['Metric', 'Exact value'], [
    [`Net revenue (${s.currency})`, s.netRevenue], ['Credit reductions (included)', s.credits], ['Return reductions (included)', s.returns],
    ['Cancellation reductions (included)', s.cancellations], ['Billing line items', String(s.transactionCount)],
  ]);
  for (let i = 0; i < s.units.length; i += 8) table(`Net quantities — separate units (${i + 1}–${Math.min(i + 8, s.units.length)})`,
    ['Unit', 'Exact net quantity'], s.units.slice(i, i + 8).map(u => [u.unit, u.quantity]));
  table('Monthly sales trend', ['Month', `Exact net revenue (${s.currency})`, 'Line items'],
    s.months.length ? s.months.map(m => [m.month, m.netRevenue, String(m.lines)]) : [['No published activity', 'No estimate', '0']]);
  for (const [label, rows] of [['SKU rankings', s.products], ['Distributor performance', s.distributors], ['Customer contribution', s.customers]] as const) {
    table(`${label} — top 8 entity/unit rows`, ['Code', 'Unit', `Net revenue (${s.currency})`, 'Net quantity'],
      rows.length ? rows.slice(0, 8).map(r => [r.code, r.unit, r.netRevenue, r.quantity]) : [['No published activity', '', '', '']]);
  }
  const checks = s.sources.flatMap(b => b.checks);
  table('Reconciliation and source coverage', ['Evidence', 'Result'], [
    ['Contributing source batches', String(s.sources.length)], ['Stored checks passed / total', `${checks.filter(c => c.passed).length} / ${checks.length}`],
    ['Source file retention', 'Original CSV files not retained'], ['Coverage', 'Activity coverage; extract completeness unverified'],
    ['Definition', s.definitionVersion], ['Metric version', s.metricVersion],
    ['Detailed source evidence', 'See Excel transaction / reconciliation sheets'],
  ]);
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
  const pptx = Buffer.from(await ppt.write({ outputType: 'nodebuffer', compression: true }) as Buffer);
  // Files are generated here, never arbitrary uploaded archives. Guard against unsafe output.
  for (const bytes of [xlsx, pptx]) {
    if (bytes.length > 16 * 1024 * 1024) throw new Error('REPORT_OUTPUT_LIMIT');
    const zip = await JSZip.loadAsync(bytes);
    if (!zip.file('[Content_Types].xml')) throw new Error('REPORT_INVALID_ARCHIVE');
    for (const [path, entry] of Object.entries(zip.files)) {
      if (/vbaProject|externalLinks|connections\.xml/i.test(path)) throw new Error('REPORT_UNSAFE_ARCHIVE');
      if (path.endsWith('.rels') && /TargetMode="External"/.test(await entry.async('string'))) throw new Error('REPORT_EXTERNAL_RELATIONSHIP');
    }
  }
  return { xlsx, pptx };
}
