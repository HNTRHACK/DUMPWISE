// Real browser/BFF/API flow. Caller supplies only newly created disposable accounts.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

export async function verifyPhase5({accounts,password,webBase,check}) {
  const browser=await chromium.launch(); const contexts=[];
  try {
    async function login(account) {
      const context=await browser.newContext({baseURL:webBase,viewport:{width:1440,height:1000},timezoneId:'Asia/Kolkata'});contexts.push(context);
      const page=await context.newPage(); await page.goto('/login');
      await page.getByLabel('Work email').fill(account.email);await page.getByLabel('Password',{exact:true}).fill(password);
      await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(/\/app$/,{timeout:30000});
      return page;
    }
    const page=await login(accounts[0]); const org=accounts[0].organizationId;
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const headers={'x-organization-id':org,'x-dumpwise-csrf':'1',origin:webBase};
    await page.goto('/app/imports');
    await page.getByText('Import templates and explicit column mapping',{exact:true}).click();
    await page.getByLabel('Template name',{exact:true}).fill('SYNTHETIC pilot mapping');
    await page.getByLabel('Business interpretation / description').fill('Net amount in document currency; fixed SAP sign rules');
    await page.getByLabel('Net value in document currency: source header',{exact:true}).fill('SYN Net Revenue');
    const created=page.waitForResponse(r=>r.url().endsWith('/api/v1/import-templates')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Save draft version',exact:true}).click();
    const templateResponse=await created;assert.equal(templateResponse.status(),201);const template=await templateResponse.json();
    await expect(page.getByText('SYNTHETIC pilot mapping v1 — DRAFT',{exact:true})).toBeVisible();
    page.once('dialog',d=>d.accept());
    await page.getByRole('button',{name:'Approve reviewed version',exact:true}).click();
    await expect(page.getByText('SYNTHETIC pilot mapping v1 — APPROVED',{exact:true})).toBeVisible();
    check('Browser creates an explicit draft and OWNER approves immutable mapping version');

    const header='Billing Date,Billing Document,Item,Billing Type,Sold-To Party,Sold-To Name,Material,Material Description,Ship-To Party,Billed Quantity,Sales Unit,SYN Net Revenue,Doc. Currency,Cancelled Bill. Doc.';
    const rows=[
      '15.09.2026,001,10,F2,100001,SYNTHETIC Dist,SYN-SKU,SYNTHETIC Product,200001,2,EA,100,INR,',
      '15.09.2026,002,10,G2,100001,SYNTHETIC Dist,SYN-SKU,SYNTHETIC Product,200001,5,EA,10,INR,',
      '15.09.2026,003,10,RE,100001,SYNTHETIC Dist,SYN-SKU,SYNTHETIC Product,200001,1,KG,20,INR,',
      '15.09.2026,004,10,S1,100001,SYNTHETIC Dist,SYN-SKU,SYNTHETIC Product,200001,1,EA,5,INR,001',
      '15.09.2026,005,10,F2,100001,SYNTHETIC Dist,SYN-SKU,SYNTHETIC Product,200001,3,EA,7,USD,',
    ];
    const csv=Buffer.from([header,...rows].join('\n')+'\n');
    const controls={schemaVersion:1,synthetic:true,
      totals:[{month:'2026-09',currency:'INR',netAmount:'65.00',lineCount:4},{month:'2026-09',currency:'USD',netAmount:'7.00',lineCount:1}],
      quantityTotals:[{month:'2026-09',unit:'EA',quantity:'4.000'},{month:'2026-09',unit:'KG',quantity:'-1.000'}]};
    await page.getByLabel('SAP billing CSV choose file').setInputFiles({name:'SYNTHETIC_pilot.csv',mimeType:'text/csv',buffer:Buffer.from(csv.toString().replaceAll('15.09.2026','03/05/2026'))});
    await page.getByLabel('Control totals choose file').setInputFiles({name:'SYNTHETIC_controls.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(controls))});
    await expect(page.getByLabel('Mapping version')).toContainText('SYNTHETIC pilot mapping v1');
    await page.getByLabel('Mapping version').selectOption(template.id);
    await page.getByRole('button',{name:'Preview mapping and rows',exact:true}).click();
    await expect(page.getByText(/File preview: 0 accepted; 5 rejected/)).toBeVisible();
    await page.getByRole('button',{name:'Import',exact:true}).click();
    await expect(page.getByText('Preview this file with the selected template first.',{exact:true})).toBeVisible();
    await page.getByLabel('SAP billing CSV choose file').setInputFiles({name:'SYNTHETIC_pilot.csv',mimeType:'text/csv',buffer:csv});
    await page.getByRole('button',{name:'Preview mapping and rows',exact:true}).click();
    await expect(page.getByText(/File preview: 5 accepted; 0 rejected; 0 duplicates/)).toBeVisible();
    const imported=page.waitForResponse(r=>r.url().endsWith('/api/v1/imports')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Import',exact:true}).click();
    const importedResponse=await imported;assert.equal(importedResponse.status(),201);const batch=await importedResponse.json();
    assert.equal(batch.outcome,'IMPORTED');
    await page.getByRole('link',{name:'Open batch',exact:true}).click();
    await page.getByRole('button',{name:'Publish',exact:true}).click();await page.getByRole('button',{name:'Publish batch',exact:true}).click();
    await expect(page.getByText('Published',{exact:true}).first()).toBeVisible();
    check('Real configurable CSV preview -> import -> independent controls reconcile -> OWNER publishes');

    const range={from:'2026-07',to:'2026-09',currency:'INR'};
    for(const dimension of ['products','distributors','customers']) {
      const r=await page.request.get(`/api/v1/analytics/${dimension}?${new URLSearchParams(range)}`,{headers});assert.equal(r.status(),200);
      assert.equal((await r.json()).summary.netRevenue,'65.00');
      await page.goto(`/app/${dimension}`);await expect(page.getByRole('heading',{name:new RegExp(`Ranked ${dimension}`)})).toBeVisible();
      await page.getByRole('button',{name:'Trace contributing transactions',exact:true}).click();
      await expect(page.getByRole('heading',{name:'Source transaction lineage',exact:true})).toBeVisible();
      const table=page.getByRole('table',{name:'Exact contributing source transactions in INR'});
      await expect(table.locator('tbody tr')).toHaveCount(4);await expect(table).toContainText('0000000001 / 000010');
    }
    const detail=await page.request.get(`/api/v1/sales/transactions?${new URLSearchParams({...range,unit:'EA',limit:'1'})}`,{headers});
    const detailJson=await detail.json();assert.equal(detailJson.summary.netRevenue,'85.00');assert.equal(detailJson.total,3);assert.equal(detailJson.items.length,1);
    check('All intelligence views drill into real paged source lines; exact currency/unit subset totals preserved');

    await page.goto('/app/reports');
    await expect(page.getByRole('button',{name:'Generate Excel and PowerPoint',exact:true})).toBeEnabled();
    let release,held;
    const gate=new Promise(resolve=>{release=resolve;});const waiting=new Promise(resolve=>{held=resolve;});
    await page.route('**/api/v1/reports',async route=>{
      if(route.request().method()==='POST'){held();await gate;}
      await route.continue();
    });
    const generated=page.waitForResponse(r=>r.url().endsWith('/api/v1/reports')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Generate Excel and PowerPoint',exact:true}).click();
    await waiting; await expect(page.getByRole('button',{name:'Generating both formats…',exact:true})).toBeDisabled();release();
    const generatedResponse=await generated;assert.equal(generatedResponse.status(),201);const report=await generatedResponse.json();
    await expect(page.getByRole('heading',{name:'Reconciled snapshot preview',exact:true})).toBeVisible();
    const snapshotResponse=await page.request.get(`/api/v1/reports/${report.id}`,{headers});const snapshot=(await snapshotResponse.json()).snapshot;
    assert.equal(snapshot.netRevenue,'65.00');assert.equal(snapshot.transactionCount,4);assert.equal(snapshot.transactions,undefined);
    for(const format of ['xlsx','pptx']) {
      const download=page.waitForEvent('download');
      await page.getByRole('button',{name:format==='xlsx'?'Download Excel':'Download PowerPoint',exact:true}).click();
      const artifact=await download;assert.equal(artifact.suggestedFilename(),`DUMPWISE-${report.id}.${format}`);
    }
    check('Report center generates, previews and downloads both private editable formats through the BFF');
    await page.getByText('Pilot review and labor-time comparison',{exact:true}).click();
    await page.getByLabel('Baseline manual labor minutes',{exact:true}).fill('90');
    await page.getByLabel('DUMPWISE workflow labor minutes',{exact:true}).fill('30');
    await page.getByLabel('Discrepancy / resolution note (optional)',{exact:true}).fill('SYNTHETIC pilot review only');
    await page.getByRole('button',{name:'Record pilot assessment',exact:true}).click();
    await expect(page.getByText(/difference 60.00 labor min/)).toBeVisible();
    check('Pilot assessment records entered labor minutes and discrepancy statement without financial ROI claims');

    const other=await login(accounts[1]); const otherHeaders={...headers,'x-organization-id':accounts[1].organizationId};
    await other.goto('/app/reports');await expect(other.getByText('No available reports',{exact:true})).toBeVisible();
    await expect(other.getByRole('button',{name:'Generate Excel and PowerPoint',exact:true})).toBeDisabled();
    const foreign=await other.request.get(`/api/v1/reports/${report.id}`,{headers:otherHeaders});assert.equal(foreign.status(),404);
    const templateForeign=await other.request.get(`/api/v1/import-templates/${template.id}`,{headers:otherHeaders});assert.equal(templateForeign.status(),404);
    const bImported=await other.request.post('/api/v1/imports',{headers:otherHeaders,multipart:{
      file:{name:'SYNTHETIC_same_ids.csv',mimeType:'text/csv',buffer:Buffer.from(csv.toString().replace('SYN Net Revenue','Net Value'))},
      controlTotals:{name:'SYNTHETIC_controls.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(controls))},
    }});assert.equal(bImported.status(),201);const bBatch=await bImported.json();
    assert.equal((await other.request.post(`/api/v1/imports/${bBatch.batchId}/publish`,{headers:otherHeaders})).status(),200);
    const aLines=(await (await page.request.get(`/api/v1/sales/transactions?${new URLSearchParams(range)}`,{headers})).json()).items;
    const bLines=(await (await other.request.get(`/api/v1/sales/transactions?${new URLSearchParams(range)}`,{headers:otherHeaders})).json()).items;
    assert.deepEqual(aLines.map(r=>r.billingDocument).sort(),bLines.map(r=>r.billingDocument).sort());
    assert(aLines.every(r=>!bLines.some(b=>b.id===r.id)));
    assert.equal((await other.request.get(`/api/v1/sales/transactions/${aLines[0].id}?${new URLSearchParams(range)}`,{headers:otherHeaders})).status(),404);
    const viewer=await login(accounts[2]);
    for(const path of ['reports','import-templates','sales/transactions?'+new URLSearchParams(range)]) {
      assert.equal((await viewer.request.get('/api/v1/'+path,{headers})).status(),403);
    }
    await viewer.goto('/app/reports');await expect(viewer.getByText('Source report permission required',{exact:true})).toBeVisible();
    check('Two organizations with identical SAP IDs remain isolated; VIEWER cannot access source reports/templates/lineage');
    await page.setViewportSize({width:375,height:850});
    const overflow=await page.evaluate(()=>Array.from(document.querySelectorAll('body *')).map(el=>{
      const r=el.getBoundingClientRect();return {tag:el.tagName,className:String(el.className).slice(0,160),right:Math.round(r.right),width:Math.round(r.width)};
    }).filter(r=>r.width>0&&r.right>innerWidth+1).slice(0,12));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`375px overflow: ${JSON.stringify(overflow)}`);
    assert.deepEqual(errors,[]);
    check('Report center fits 375px viewport and owner flow has no uncaught page errors');
    return {reportId:report.id,templateVersionId:template.id,netRevenue:'65.00',currency:'INR',enteredLaborMinutes:{manual:'90.00',automated:'30.00',difference:'60.00',source:'USER_ENTERED_TEST_INPUT'}};
  } finally {for(const context of contexts)await context.close();await browser.close();}
}
