// Called only by apps/api/scripts/verify-phase4-live.mjs with disposable credentials.
// No mocked API responses, traces, cookie files or auth-response logs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';

const index = m => Number(m.slice(0,4))*12 + Number(m.slice(5))-1;
const month = i => `${Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`;
const minor = (s, scale=2) => {
  const negative = s.startsWith('-'), [whole, fraction=''] = s.replace(/^[-+]/,'').split('.');
  const n = BigInt(whole)*10n**BigInt(scale) + BigInt(fraction.padEnd(scale,'0'));
  return negative ? -n : n;
};
const fixed = (n, scale=2) => { const s=(n<0n?-n:n).toString().padStart(scale+1,'0'); return `${n<0n?'-':''}${s.slice(0,-scale)}.${s.slice(-scale)}`; };
const money = (n,c) => new Intl.NumberFormat(c==='INR'?'en-IN':'en-US',{style:'currency',currency:c,minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
const dimensions = {products:['product_id','sku','description'],distributors:['distributor_id','code','name'],customers:['customer_id','code','name']};

export async function verifyPhase4({source, accounts, password, webBase, apiBase, check, report}) {
  const now = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit'}).formatToParts(new Date());
  const currentMonth = `${now.find(p=>p.type==='year').value}-${now.find(p=>p.type==='month').value}`;
  const to = month(index(currentMonth)-1);
  const ranges = [3,6,12].map(n=>({from:month(index(to)-n+1),to}));
  report.ranges = ranges;
  const org = accounts[0].organizationId;
  const controls = JSON.parse(readFileSync(new URL('../../../../data/synthetic/SYNTHETIC_sap_billing_2025-10_to_2026-09.control_totals.json',import.meta.url),'utf8'));
  async function oracle(dimension, q, productId=null) {
    const [fk,code,name]=dimensions[dimension];
    const current = index(q.from), count = index(q.to)-current+1;
    const query = async (start,end) => (await source.query(`
      SELECT e.id,e.${code} AS code,e.${name} AS name,t.sales_unit AS unit,
        SUM(t.net_amount)::text AS net, SUM(t.quantity)::text AS qty, COUNT(*)::int AS lines,
        (-COALESCE(SUM(t.net_amount) FILTER(WHERE t.billing_type='G2'),0))::text AS credits,
        (-COALESCE(SUM(t.net_amount) FILTER(WHERE t.billing_type='RE'),0))::text AS returns,
        (-COALESCE(SUM(t.net_amount) FILTER(WHERE t.billing_type='S1'),0))::text AS cancellations,
        COUNT(DISTINCT to_char(t.billing_date,'YYYY-MM'))::int AS coverage
      FROM sales_transactions t
      JOIN ${dimension} e ON e.id=t.${fk} AND e.organization_id=t.organization_id
      JOIN import_batches b ON b.id=t.import_batch_id AND b.organization_id=t.organization_id
      WHERE t.organization_id=$1::uuid AND t.currency=$2
        AND t.billing_date >= $3::date AND t.billing_date < $4::date
        AND ($5::text IS NULL OR t.sales_unit=$5)
        AND ($6::uuid IS NULL OR e.id=$6)
        AND (position(lower($7) in lower(e.${code}))>0 OR position(lower($7) in lower(COALESCE(e.${name},'')))>0)
        AND b.status='PUBLISHED' AND b.reconciliation_status='PASSED'
      GROUP BY e.id,e.${code},e.${name},t.sales_unit`,[org,q.currency,`${start}-01`,`${end}-01`,q.unit??null,productId,q.search??''])).rows;
    const rows=await query(q.from,month(index(q.to)+1)), prior=await query(month(current-count),q.from);
    const items=rows.map(r=>{
      const old=prior.find(p=>p.id===r.id&&p.unit===r.unit), previous=old?.net??'0.00';
      let growthPercent=null,growthReason=null;
      if(r.coverage!==count||old?.coverage!==count) growthReason='Incomplete comparison coverage';
      else if(minor(previous)<=0n) growthReason='Previous revenue is zero or negative';
      else { const n=(minor(r.net)-minor(previous))*10000n, abs=n<0n?-n:n, base=minor(previous); growthPercent=fixed((n<0n?-1n:1n)*((abs*2n+base)/(2n*base))); }
      return {id:r.id,code:r.code,name:r.name,unit:r.unit,netRevenue:fixed(minor(r.net)),creditedAmount:fixed(minor(String(r.credits))),returnedAmount:fixed(minor(String(r.returns))),cancelledAmount:fixed(minor(String(r.cancellations))),netQuantity:fixed(minor(r.qty,3),3),transactionCount:r.lines,previousRevenue:fixed(minor(previous)),growthPercent,growthReason};
    });
    const total = field => fixed(items.reduce((n,r)=>n+minor(r[field]),0n));
    const units=[...new Set(items.map(r=>r.unit))].sort().map(unit=>({unit,quantity:fixed(items.filter(r=>r.unit===unit).reduce((n,r)=>n+minor(r.netQuantity,3),0n),3)}));
    return {items,summary:{netRevenue:total('netRevenue'),creditedAmount:total('creditedAmount'),returnedAmount:total('returnedAmount'),cancelledAmount:total('cancelledAmount'),transactionCount:items.reduce((n,r)=>n+r.transactionCount,0),units}};
  }
  const browser=await chromium.launch();
  const contexts=[];
  try {
    const context=await browser.newContext({baseURL:webBase,viewport:{width:1440,height:1000},timezoneId:'Asia/Kolkata'}); contexts.push(context);
    const page=await context.newPage();
    const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
    const login=async (p,account)=>{
      await p.goto('/login'); await p.getByLabel('Work email').fill(account.email); await p.getByLabel('Password').fill(password);
      await p.getByRole('button',{name:'Sign in',exact:true}).click(); await expect(p).toHaveURL(/\/app$/, {timeout:30000});
      await expect(p.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();
    };
    await login(page,accounts[0]);
    const session=await (await page.request.get('/api/auth/session')).json();
    assert.deepEqual(session.memberships.map(m=>m.organizationId),[org]);
    check('Real browser login -> HttpOnly BFF session -> real Nest authentication on disposable PostgreSQL');
    const get=async(path,q,organizationId=org,request=page.request)=>request.get(`/api/v1/${path}?${new URLSearchParams(q)}`,{headers:{'x-organization-id':organizationId}});
    const json=async(path,q)=>{const response=await get(path,q);assert.equal(response.status(),200,`GET ${path} failed`);return response.json();};
    const sortRows=(items,key,direction)=>[...items].sort((a,b)=>{
      let cmp;
      if(key==='code')cmp=a.code<b.code?-1:a.code>b.code?1:0;
      else {const x=key==='transactionCount'?BigInt(a[key]):minor(a[key],key==='netQuantity'?3:2),y=key==='transactionCount'?BigInt(b[key]):minor(b[key],key==='netQuantity'?3:2);cmp=x<y?-1:x>y?1:0;}
      return cmp*(direction==='asc'?1:-1)||a.id.localeCompare(b.id)||a.unit.localeCompare(b.unit);
    });
    for(const range of ranges) for(const currency of ['INR','USD']) {
      const q={...range,currency};
      const monthly=await json('sales/monthly',range);
      const monthlyNet=fixed(monthly.months.filter(m=>m.currency===currency).reduce((n,m)=>n+minor(m.totalNetSales),0n));
      const control=fixed(controls.totals.filter(t=>t.currency===currency&&t.month>=range.from&&t.month<=range.to).reduce((n,t)=>n+minor(t.netAmount),0n));
      assert.equal(monthlyNet,control,'Published monthly summary differs from independent Python control totals');
      for(const dimension of Object.keys(dimensions)) {
        const expected=await oracle(dimension,q), first=await json(`analytics/${dimension}`,{...q,limit:'7'});
        assert.deepEqual(first.summary,expected.summary,`${dimension} summary mismatch`);
        assert.equal(first.summary.netRevenue,monthlyNet);
        assert.equal(first.total,expected.items.length);
        const collected=[...first.items];
        for(let offset=7;offset<first.total;offset+=7) collected.push(...(await json(`analytics/${dimension}`,{...q,limit:'7',offset:String(offset)})).items);
        assert.deepEqual(collected,sortRows(expected.items,'netRevenue','desc'),`${dimension} paged rows mismatch`);
        for(const sort of ['code','transactionCount']) for(const direction of ['asc','desc']) {
          const sorted=await json(`analytics/${dimension}`,{...q,sort,direction,limit:'100'});
          assert.deepEqual(sorted.items,sortRows(expected.items,sort,direction).slice(0,100));
        }
        for(const unit of expected.summary.units.map(u=>u.unit)) {
          const filtered={...q,unit}, unitExpected=await oracle(dimension,filtered);
          const result=await json(`analytics/${dimension}`,{...filtered,sort:'netQuantity',limit:'100'});
          assert.deepEqual(result.summary,unitExpected.summary);
          assert.deepEqual(result.items,sortRows(unitExpected.items,'netQuantity','desc').slice(0,100));
        }
        const selected=expected.items[0];
        if(selected) {
          const filtered={...q,search:selected.code.toLowerCase()};
          const found=await json(`analytics/${dimension}`,{...filtered,limit:'100'});
          assert.deepEqual(found.summary,(await oracle(dimension,filtered)).summary);
        }
      }
      report.totals.push({...q,netRevenue:monthlyNet,pythonControl:control});
      check(`${range.from}..${range.to} ${currency}: all dimensions, full SQL rows/credits/quantities/growth, summaries, Python controls, filters, numeric/code sorts and 7-row pagination`);
    }
    const range=ranges[2], q={...range,currency:'INR'};
    const products=await json('analytics/products',{...q,limit:'100'});
    const product=products.items[0];assert(product);
    for(const currency of ['INR','USD']) for(const unit of ['',...products.summary.units.map(u=>u.unit)]) {
      const filters={...range,currency,...(unit?{unit}:{})};
      const trend=await json(`analytics/products/${product.id}/trend`,filters);
      const raw=(await source.query(`SELECT to_char(t.billing_date,'YYYY-MM') AS month,t.sales_unit AS unit,SUM(t.net_amount)::text AS net,SUM(t.quantity)::text AS qty,COUNT(*)::int AS lines
        FROM sales_transactions t JOIN import_batches b ON b.id=t.import_batch_id AND b.organization_id=t.organization_id
        WHERE t.organization_id=$1 AND t.product_id=$2 AND t.currency=$3 AND t.billing_date>=$4::date AND t.billing_date<$5::date
        AND ($6::text IS NULL OR t.sales_unit=$6) AND b.status='PUBLISHED' AND b.reconciliation_status='PASSED' GROUP BY 1,2 ORDER BY 1,2`,[org,product.id,currency,`${range.from}-01`,`${month(index(range.to)+1)}-01`,unit||null])).rows;
      const expected=[...new Set(raw.map(r=>r.month))].map(month=>{const rows=raw.filter(r=>r.month===month);return {month,currency,totalNetSales:fixed(rows.reduce((n,r)=>n+minor(r.net),0n)),transactionCount:rows.reduce((n,r)=>n+r.lines,0),unitsSold:rows.map(r=>({unit:r.unit,quantity:fixed(minor(r.qty,3),3)}))};});
      assert.deepEqual(trend.months,expected);
    }
    check('Product trends in INR/USD and each unit equal independent monthly SQL; absent months are omitted');

    // Hold one real request briefly to observe loading, then continue to the actual API.
    let release, resumed;const gate=new Promise(resolve=>{release=resolve;});const continued=new Promise(resolve=>{resumed=resolve;});let intercepted=false;
    await page.route('**/api/v1/analytics/products?*',async route=>{intercepted=true;await gate;try { await route.continue(); } finally { resumed(); }});
    await page.goto('/app/products');
    await expect.poll(()=>intercepted).toBe(true);
    await expect(page.locator('.animate-shimmer').first()).toBeVisible();release();await continued;await page.unroute('**/api/v1/analytics/products?*');
    await expect(page.getByRole('table',{name:/Products analytics in INR/})).toBeVisible();
    check('Browser loading state before real analytics response');
    for(const dimension of Object.keys(dimensions)) {
      await page.goto(`/app/${dimension}`);
      const table=page.getByRole('table',{name:new RegExp(`${dimension} analytics in INR`,'i')});await expect(table).toBeVisible();
      const expected=await oracle(dimension,q);
      await expect(page.locator('p').filter({hasText:/^Net revenue$/}).locator('..')).toContainText(money(expected.summary.netRevenue,'INR'));
      if(dimension==='products') {
        await page.getByRole('button',{name:product.code,exact:true}).first().click();
        await expect(page.getByRole('table',{name:`Exact monthly product trend for ${product.code}`})).toBeVisible();
        await expect(page.getByRole('figure').last()).toBeVisible();
      }
      await page.getByLabel('Search code or name').fill('__NO_SYNTHETIC_MATCH__');await expect(page.getByText('No matching billing activity')).toBeVisible();
      await expect(page.getByText('0 entity/unit rows · 0–0',{exact:true})).toBeVisible();
      await page.getByLabel('Search code or name').fill('');await expect(table).toBeVisible();
      await page.getByLabel('Unit',{exact:true}).selectOption(expected.summary.units[0].unit);await expect(table).toBeVisible();
      await page.getByLabel('Sort by').selectOption('netQuantity');await expect(table).toBeVisible();
      await page.getByRole('radio',{name:'USD',exact:true}).click();await expect(page.getByRole('table',{name:new RegExp(`${dimension} analytics in USD`,'i')})).toBeVisible();
      await page.setViewportSize({width:375,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.getByRole('combobox',{name:'Range',exact:true}).selectOption('3');
      await expect(page.getByRole('table',{name:new RegExp(`${dimension} analytics in USD`,'i')})).toBeVisible();
      await page.setViewportSize({width:1440,height:1000});await page.getByRole('combobox',{name:'Range',exact:true}).selectOption('12');
      await page.getByRole('radio',{name:'INR',exact:true}).click();
    }
    check('Real Products/Distributors/Customers pages: exact KPI, product chart/table, empty/filter/unit/sort/currency/range states and 375px layout');
    const otherOrg=accounts[1].organizationId;
    for(const dimension of Object.keys(dimensions)) assert.equal((await get(`analytics/${dimension}`,q,otherOrg)).status(),403);
    const contextB=await browser.newContext({baseURL:webBase});contexts.push(contextB);const pageB=await contextB.newPage();await login(pageB,accounts[1]);
    assert.equal((await get(`analytics/products/${product.id}/trend`,q,otherOrg,pageB.request)).status(),404);
    for(const dimension of Object.keys(dimensions)) assert.equal((await get(`analytics/${dimension}`,q,otherOrg,pageB.request)).status(),200);
    const anonymous=await browser.newContext({baseURL:webBase});contexts.push(anonymous);
    assert.equal((await anonymous.request.get(`/api/v1/analytics/products?${new URLSearchParams(q)}`,{headers:{'x-organization-id':org}})).status(),401);
    assert.equal((await fetch(`${apiBase}/v1/analytics/products?${new URLSearchParams(q)}`,{headers:{'x-organization-id':org}})).status,401);
    check('Organization isolation: A cannot query B (403), B cannot resolve A product (404), B can read own reports, anonymous BFF/Nest calls denied (401)');
    // Permission error is a real Nest response, not an intercepted/fabricated response.
    await page.route('**/api/v1/analytics/products?*',route=>route.continue({headers:{...route.request().headers(),'x-organization-id':otherOrg}}));
    await page.goto('/app/products');await expect(page.getByText("You don't have access to this")).toBeVisible();
    await expect(page.getByRole('table',{name:/Products analytics/})).toHaveCount(0);
    await page.unroute('**/api/v1/analytics/products?*');await page.reload();await expect(page.getByRole('table',{name:/Products analytics/})).toBeVisible();
    check('Browser error/permission state from actual 403 and recovery after authorized reload');
    for(const extra of [{sort:'invalid'},{limit:'101'},{offset:'-1'},{sort:'netQuantity'},{from:'2026-13'},{from:'2027-01'},{currency:'inr'}]) assert.equal((await get('analytics/products',{...q,...extra})).status(),400);
    assert.equal((await get('analytics/products',{...q,search:"%' OR 1=1 --"})).status(),200);
    assert.equal((await json('analytics/products',{...q,from:'2099-01',to:'2099-03'})).total,0);
    check('Real API validation, SQL-like literal search and empty future range');
    assert.deepEqual(pageErrors,[]);
    check('No uncaught browser page errors');
  } finally { for(const c of contexts)await c.close();await browser.close(); }
}
