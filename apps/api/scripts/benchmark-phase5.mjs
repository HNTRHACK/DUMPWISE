// CPU/memory-only synthetic benchmark. No database connection or file export persistence.
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { summarizeSnapshot } from '../dist/reports/report-snapshot.js';
import { reportFiles } from '../dist/reports/report-files.js';
const results = [];
for (const count of [100, 1000, 5000]) {
  const facts = Array.from({length: count}, (_, i) => ({
    id: `SYNTHETIC-${i}`, date: `2026-${String(i % 12 + 1).padStart(2,'0')}-15`, document: String(i).padStart(10,'0'),
    item: '000010', type: i % 20 === 0 ? 'G2' : 'F2', sku: `SYN-SKU-${i % 200}`, distributor: `SYN-DIST-${i % 30}`,
    customer: `SYN-CUST-${i % 100}`, amount: i % 20 === 0 ? '-10.25' : '100.25', quantity: i % 20 === 0 ? '0.000' : '1.250',
    currency: 'INR', unit: i % 2 ? 'EA' : 'KG', batchId: 'SYNTHETIC-BATCH', line: i + 2,
    templateVersionId: null, rulesVersion: 'sap-billing-signs-v1',
  }));
  const samples = [];
  for (let run = 0; run < 3; run++) {
    const t0 = performance.now();
    const snapshot = summarizeSnapshot({ organizationId: 'SYNTHETIC', organizationName: 'SYNTHETIC benchmark', classification: 'SYNTHETIC',
      generatedAt: new Date().toISOString(), from: '2026-01', to: '2026-12', previousFrom: '2025-01', previousTo: '2025-12', currency: 'INR', unit: null,
      transactions: [], sources: [] }, facts, 12);
    const t1 = performance.now(); const files = await reportFiles(snapshot); const t2 = performance.now();
    samples.push({ aggregationMs: Math.round((t1-t0)*100)/100, fileGenerationMs: Math.round((t2-t1)*100)/100,
      xlsxBytes: files.xlsx.length, pptxBytes: files.pptx.length });
  }
  results.push({ facts: count, samples });
}
const evidence = { generatedAt: new Date().toISOString(), node: process.version,
  scope: 'Synthetic in-process aggregation + XLSX/PPTX encoding/integrity checks only. No SQL, HTTP, concurrency or company workflow comparison.', results };
writeFileSync(new URL('../../../docs/phase5-performance.json',import.meta.url), JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
