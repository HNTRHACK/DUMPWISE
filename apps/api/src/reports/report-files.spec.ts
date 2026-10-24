import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { reportFiles, spreadsheetText } from './report-files.js';
import { summarizeSnapshot, type ReportFact } from './report-snapshot.js';

export const testSnapshot = () => {
  const base: ReportFact = { id: 'synthetic-line', date: '2026-09-15', document: '0000000001', item: '000010', type: 'F2',
    sku: '=HYPERLINK("bad")', distributor: 'SYN-DIST', customer: 'SYN-CUST', amount: '999999999999999.99', quantity: '2.000',
    currency: 'INR', unit: 'EA', batchId: 'synthetic-batch', line: 2, templateVersionId: null, rulesVersion: 'sap-billing-signs-v1' };
  return summarizeSnapshot({ organizationId: 'synthetic-org', organizationName: 'SYNTHETIC DUMPWISE', classification: 'SYNTHETIC',
    generatedAt: '2026-10-25T00:00:00.000Z', from: '2026-07', to: '2026-09', currency: 'INR', unit: null,
    previousFrom: '2026-04', previousTo: '2026-06', transactions: [], sources: [] },
    [base, { ...base, id: 'credit', document: '0000000002', type: 'G2', amount: '-10.00', quantity: '0.000' },
      { ...base, id: 'return', document: '0000000003', type: 'RE', unit: 'KG', amount: '-20.00', quantity: '-1.000' }], 3);
};

describe('exact shared management snapshot and editable Office files', () => {
  it('preserves very large cents, credits, separated units and missing-period growth', () => {
    const s = testSnapshot();
    expect(s.netRevenue).toBe('999999999999969.99');
    expect(s.credits).toBe('10.00'); expect(s.returns).toBe('20.00');
    expect(s.units).toEqual([{ unit: 'EA', quantity: '2.000' }, { unit: 'KG', quantity: '-1.000' }]);
    expect(s.products.every(p => p.growthPercent === null)).toBe(true);
    expect(spreadsheetText(' \t=WEBSERVICE("bad")')).toBe('\' \t=WEBSERVICE("bad")');
    expect(spreadsheetText('-20.00')).toBe('-20.00');
  });
  it('emits exact text cells, safe source strings, no formulas/connections and editable PPTX tables', async () => {
    const s = testSnapshot(); const files = await reportFiles(s);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(files.xlsx as unknown as ExcelJS.Buffer);
    const reportRows = wb.getWorksheet('Report')!.getRows(1, 25)!;
    expect(reportRows.find(r => r.getCell(1).value === 'Net revenue')!.getCell(2).value).toBe(s.netRevenue);
    expect(wb.getWorksheet('Transactions')!.getCell('F2').value).toBe('\'=HYPERLINK("bad")');
    expect(wb.getWorksheet('Transactions')!.getCell('C2').value).toBe('0000000001');
    expect(wb.getWorksheet('Transactions')!.getCell('I3').value).toBe('-10.00');
    wb.eachSheet(ws => ws.eachRow(row => row.eachCell(cell => expect(cell.type).not.toBe(ExcelJS.ValueType.Formula))));
    const zip = await JSZip.loadAsync(files.pptx);
    const slides = Object.keys(zip.files).filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p));
    expect(slides.length).toBe(8);
    const xml = await Promise.all(slides.map(p => zip.file(p)!.async('string')));
    expect(xml.join('')).toContain(s.netRevenue);
    expect(xml.join('')).toContain('<a:tbl>');
    expect(xml.join('')).toContain('SYNTHETIC');
    expect(Object.keys(zip.files).some(p => /vba|externalLinks/i.test(p))).toBe(false);
  });
});
