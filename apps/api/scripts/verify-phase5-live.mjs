// Fresh synthetic pilot environment only. Never connects to dumpwise_dev.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
const tag = randomBytes(8).toString('hex'); const database = `dumpwise_pilot_${tag}_test`;
const apiDir = fileURLToPath(new URL('../',import.meta.url)), webDir = fileURLToPath(new URL('../../web/',import.meta.url));
const children = []; let target;
const report = { database, syntheticOnly: true, developmentConnectionOpened: false, checks: [] };
const check = label => { report.checks.push(label); console.log(`PASS ${label}`); };
function run(cwd,args,env) {
  const r = spawnSync(process.execPath,args,{cwd,env,stdio:'inherit'}); assert.equal(r.status,0,'Verification build/setup failed');
}
async function port() {
  const s=createServer(); await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));
  const p=s.address().port; await new Promise(resolve=>s.close(resolve)); return p;
}
async function start(cwd,args,env,url) {
  const child=spawn(process.execPath,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  children.push(child); child.stdout.resume(); child.stderr.resume();
  for(let i=0;i<300;i++) {
    if(child.exitCode!==null) throw new Error('Disposable service startup failed');
    try { if((await fetch(url)).ok) return; } catch { /* wait for own child */ }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Disposable service readiness timed out');
}
try {
  const adminUrl=new URL(process.env.MIGRATION_DATABASE_URL); adminUrl.pathname='/postgres';
  const maintenance=new pg.Client({connectionString:adminUrl.toString()}); await maintenance.connect();
  try { await maintenance.query(`CREATE DATABASE "${database}"`); } finally { await maintenance.end(); }
  adminUrl.pathname=`/${database}`;
  const runtime=new URL(adminUrl); runtime.username=`dw_pilot_${tag}`; runtime.password=randomBytes(24).toString('hex');
  const provisioner=new URL(adminUrl); provisioner.username=`dw_pilotprov_${tag}`; provisioner.password=randomBytes(24).toString('hex');
  const env={...process.env,NODE_ENV:'test',DATABASE_URL:runtime.toString(),MIGRATION_DATABASE_URL:adminUrl.toString(),
    TEST_DATABASE_URL:runtime.toString(),PROVISIONER_DATABASE_URL:provisioner.toString(),TEST_PROVISIONER_DATABASE_URL:provisioner.toString(),
    TEST_MIGRATION_DATABASE_URL:adminUrl.toString(),APP_DB_USER:runtime.username,APP_DB_PASSWORD:runtime.password,
    PROVISIONER_DB_USER:provisioner.username,PROVISIONER_DB_PASSWORD:provisioner.password,RATE_LIMIT_DEFAULT_PER_MINUTE:'100000'};
  run(apiDir,['node_modules/@nestjs/cli/bin/nest.js','build'],env);
  run(apiDir,['node_modules/prisma/build/index.js','migrate','deploy'],env);
  run(apiDir,['scripts/setup-db-roles.ts','--test'],env);
  target=new pg.Client({connectionString:adminUrl.toString()}); await target.connect();
  assert.equal((await target.query('SELECT current_database() AS db')).rows[0].db,database);
  const password=`violet river pilot ${randomBytes(16).toString('hex')}`;
  const {hashPassword}=await import('../dist/auth/password-hasher.js'); const hash=await hashPassword(password);
  const accounts=[];
  for(const [n,role] of [[0,'OWNER'],[1,'OWNER'],[0,'VIEWER']]) {
    let organizationId=accounts.find(a=>a.index===n)?.organizationId;
    if(!organizationId) {
      organizationId=randomUUID();
      await target.query("INSERT INTO organizations(id,name,slug,data_classification,updated_at) VALUES($1,$2,$3,'SYNTHETIC',now())",[organizationId,`SYNTHETIC Pilot ${n}`,`synthetic-pilot-${n}`]);
    }
    const id=randomUUID(), email=`pilot-${randomBytes(8).toString('hex')}@example.invalid`;
    await target.query('INSERT INTO users(id,email,display_name,password_hash,updated_at) VALUES($1,$2,$3,$4,now())',[id,email,'SYNTHETIC pilot verification',hash]);
    await target.query('INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,$3)',[organizationId,id,role]);
    accounts.push({id,email,organizationId,index:n,role});
  }
  check('Fresh database and isolated synthetic OWNER/VIEWER accounts; no development connection opened');
  const apiPort=await port(),webPort=await port(),apiBase=`http://127.0.0.1:${apiPort}`,webBase=`http://127.0.0.1:${webPort}`;
  await start(apiDir,['dist/main.js'],{...env,HOST:'127.0.0.1',PORT:String(apiPort)},`${apiBase}/health`);
  run(webDir,['node_modules/next/dist/bin/next','build'],{...process.env,NODE_ENV:'production',DUMPWISE_API_URL:apiBase,DUMPWISE_COOKIE_SECURE:'false'});
  await start(webDir,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(webPort)],{...process.env,NODE_ENV:'production',DUMPWISE_API_URL:apiBase,DUMPWISE_COOKIE_SECURE:'false',DUMPWISE_APP_ORIGIN:webBase},`${webBase}/login`);
  const {verifyPhase5}=await import('../../web/test/live/phase5-verify.mjs');
  const evidence=await verifyPhase5({accounts,password,webBase,check});
  Object.assign(report,evidence);
  const stored=(await target.query('SELECT snapshot,xlsx,pptx FROM report_snapshots WHERE organization_id=$1 AND id=$2',[accounts[0].organizationId,evidence.reportId])).rows[0];
  const independent=(await target.query("SELECT SUM(t.net_amount)::text AS net,COUNT(*)::int AS lines FROM sales_transactions t JOIN import_batches b ON b.id=t.import_batch_id AND b.organization_id=t.organization_id WHERE t.organization_id=$1 AND t.currency='INR' AND b.status='PUBLISHED' AND b.reconciliation_status='PASSED'",[accounts[0].organizationId])).rows[0];
  assert.equal(stored.snapshot.netRevenue,independent.net); assert.equal(stored.snapshot.transactionCount,independent.lines);
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(stored.xlsx);
  assert.equal(wb.getWorksheet('Report').getRows(1,25).find(r=>r.getCell(1).value==='Net revenue').getCell(2).value,independent.net);
  const zip=await JSZip.loadAsync(stored.pptx); assert((await zip.file('ppt/slides/slide2.xml').async('string')).includes(independent.net));
  check('Independent SQL = stored snapshot = exact XLSX cell = editable PPTX sales table');
  report.netRevenue=independent.net; report.lines=independent.lines; report.ok=true;
} catch(e) {
  report.ok=false; report.error={name:e.name,message:e.message.replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted URL]')};
  console.error('Pilot verification failed:',e.name); process.exitCode=1;
} finally {
  children.reverse().forEach(child=>child.kill()); await target?.end().catch(()=>{});
  writeFileSync(new URL('../../../docs/phase5-live-evidence.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(`Disposable pilot database retained: ${database}; success=${report.ok}`);
}
