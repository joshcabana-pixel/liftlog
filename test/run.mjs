/* Lift Log regression suite. Run: node test/run.mjs  (needs: npm i -D playwright, Chromium)
   Set CHROMIUM=/path/to/chromium if not using Playwright's default browser.
   Every release must pass this before it ships. */
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.webmanifest':'application/manifest+json'};

let passed=0, failed=0;
function ok(cond, name, extra=''){
  if(cond){ passed++; console.log('  ✓', name); }
  else { failed++; console.log('  ✗ FAIL:', name, extra); }
}

// --- tiny static server ---
const server = http.createServer((req,res)=>{
  let p = req.url.split('?')[0]; if(p==='/') p='/index.html';
  const f = path.join(ROOT, p);
  if(!f.startsWith(ROOT) || !fs.existsSync(f)){ res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'content-type': MIME[path.extname(f)]||'application/octet-stream'});
  res.end(fs.readFileSync(f));
});
await new Promise(r=>server.listen(0, r));
const URL_ = `http://localhost:${server.address().port}/`;

// --- test CSV fixture: built from seed, with 2 "sheet-logged" rows added ---
const seed = JSON.parse(fs.readFileSync(path.join(ROOT,'data/seed.json'),'utf8'));
const HDR = ['Workout','Exercise','Set','RIR','Last time','Time before','Weight','Reps','Skip reason','Date','Joint pain','Pump','Soreness','Volume','Notes','Meso','Week','Day','Day label','Muscle'];
function csvCell(v){ v=String(v??''); return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; }
function planToCsvRow(r, over={}){
  const m = {...r, ...over};
  return [m.meso+' W'+m.wk, m.ex, m.set, m.rir??'', '', '', m.w??'', m.r??'', m.skip??'', m.date?`${+m.date.slice(5,7)}/${+m.date.slice(8,10)}/${m.date.slice(2,4)}`:'', m.joint??'', '', '', '', '', m.meso, m.wk, m.day, m.label, m.muscle].map(csvCell).join(',');
}
const p0 = seed.plan[seed.plan.length-2], p1 = seed.plan[seed.plan.length-1]; // untouched by UI steps
const doneCsv = seed.sets.slice(-50).map(r=>planToCsvRow(r)); // 50 already-known rows -> must dedupe
const csv = [HDR.join(','), ...doneCsv,
  planToCsvRow(p0, {w:85, r:24, date:'2026-10-08', joint:'Low'}),
  planToCsvRow(p1, {skip:'Equipment busy', date:'2026-10-08'})].join('\n');
const CSV_PATH = path.join(ROOT,'test','fixture-sheet.csv');
fs.writeFileSync(CSV_PATH, csv);

const browser = await chromium.launch({executablePath: process.env.CHROMIUM || undefined});
const pg = await browser.newPage({viewport:{width:390, height:844}});
const alerts=[]; const errors=[];
pg.on('dialog', async d=>{ alerts.push(d.message()); await d.accept(); });
pg.on('pageerror', e=>errors.push(e.message));
const state = ()=>pg.evaluate(()=>JSON.parse(localStorage.getItem('liftlog.v1')));

console.log('1. First run & seed');
await pg.goto(URL_);
await pg.waitForSelector('#b-seed', {state:'visible'});
ok(await pg.locator('#b-seed').isVisible(), 'first-run screen shows (seed button visible locally)');
await pg.click('#b-seed'); await pg.waitForSelector('.card h2');
let db = await state();
ok(db.sets.length>=2170 && db.plan.length>=170, 'seed loaded', `${db.sets.length}/${db.plan.length}`);

console.log('2. Workout screen & lookups');
ok((await pg.textContent('#hd-title')).includes('Week 3'), 'current workout is Meso 9 W3');
const hist1 = await pg.locator('.setrow .hist').first().textContent();
ok(hist1.includes('85 × 23') && hist1.includes('85 × 21'), 'lookup matches sheet (85×23 / 85×21)', hist1);

console.log('3. Log / undo / skip / persistence');
const row1 = pg.locator('.setrow').first();
await row1.locator('input').nth(0).fill('85.5');            // decimal weight edge case
await row1.locator('input').nth(1).fill('24');
await row1.locator('.ok').click(); await pg.waitForTimeout(200);
ok((await pg.locator('.setrow').first().getAttribute('class')).includes('done'), 'set logged');
db = await state();
ok(db.sets.some(r=>r.w===85.5 && r.r===24), 'decimal weight stored exactly');
await pg.reload(); await pg.waitForSelector('.setrow');
ok((await pg.locator('.setrow').first().getAttribute('class')).includes('done'), 'persists across reload');
await pg.locator('.setrow').first().locator('.ok').click(); await pg.waitForTimeout(200); // undo
db = await state();
ok(!db.sets.some(r=>r.w===85.5), 'undo removed the set');
const pend = pg.locator('.setrow:not(.done)').first();
await pend.locator('.ok').click(); await pg.waitForSelector('#dlg[open]');
await pg.click('#dlg #k'); await pg.waitForTimeout(200);
ok(await pg.locator('.setrow.skipped').count()>0, 'skip with reason');
await pg.locator('.setrow.skipped .ok').first().click(); await pg.waitForTimeout(200);
ok(await pg.locator('.setrow.skipped').count()===0, 'unskip restores the set');

console.log('4. Feedback pills');
// log set 1 again so feedback has an anchor
await pg.locator('.setrow').first().locator('input').nth(0).fill('85');
await pg.locator('.setrow').first().locator('input').nth(1).fill('24');
await pg.locator('.setrow').first().locator('.ok').click(); await pg.waitForTimeout(200);
await pg.locator('.fb .pill', {hasText:'Low'}).first().click(); await pg.waitForTimeout(200);
db = await state();
ok(db.sets.some(r=>r.joint==='Low' && r.w===85), 'joint pain saved on set 1');

console.log('8. History & Insights render');
await pg.click('nav button[data-v=history]'); await pg.waitForTimeout(300);
await pg.selectOption('select','Bench Press (Medium Grip)'); await pg.waitForTimeout(300);
ok(await pg.locator('svg[role=img]').count()===1, 'chart renders');
ok(await pg.locator('.list-item:has-text("break:")').count()>0, 'break markers shown');
await pg.click('nav button[data-v=insights]'); await pg.waitForTimeout(300);
const insights = await pg.locator('main').innerText();
ok(/After a deload/.test(insights) && /%/.test(insights), 'deload/break stats shown');
ok(/skipped last \d+ sessions/.test(insights), 'consecutive-skip flag shown');


console.log('5. Meso tab: sets +/- , add exercise, new meso ordering');
await pg.click('nav button[data-v=plan]'); await pg.waitForTimeout(200);
const planBefore = (await state()).plan.length;
await pg.locator('.card').first().locator('[data-a="+"]').first().click(); await pg.waitForTimeout(150);
ok((await state()).plan.length===planBefore+1, '+1 set');
await pg.locator('.card').first().locator('[data-a="-"]').first().click(); await pg.waitForTimeout(150);
ok((await state()).plan.length===planBefore, '-1 set');
await pg.locator('.card').first().locator('.skiplink').click(); await pg.waitForSelector('#dlg[open]');
await pg.selectOption('#a-e','Hack Squat'); await pg.click('#dlg #k'); await pg.waitForTimeout(250);
db = await state();
const hs = db.plan.filter(r=>r.ex==='Hack Squat');
ok(hs.length>0, 'exercise added to day');
const hsDl = hs.filter(r=>r.rir==='Deload');
ok(hsDl.length>0 && hsDl.length < hs.filter(r=>r.rir!=='Deload').length/ (new Set(hs.filter(r=>r.rir!=='Deload').map(r=>r.wk)).size) + 1, 'propagated incl. halved deload');
await pg.click('main > button'); await pg.waitForSelector('#dlg[open]');
ok(await pg.inputValue('#m-n')==='Meso 10', 'next meso auto-named');
await pg.click('#dlg #k'); await pg.waitForTimeout(300);
db = await state();
ok(db.currentMeso==='Meso 10', 'currentMeso updated');
ok(db.plan[0].meso.startsWith('Meso 9'), 'Meso 9 still first in queue');
const m10rirs = [...new Set(db.plan.filter(r=>r.meso==='Meso 10').sort((a,b)=>a.wk-b.wk).map(r=>r.rir))];
ok(JSON.stringify(m10rirs)===JSON.stringify([3,2,1,0,'Deload']), 'RIR pattern 3→2→2→1→0→Deload', JSON.stringify(m10rirs));
await pg.click('nav button[data-v=workout]'); await pg.waitForTimeout(200);
ok((await pg.textContent('#hd-title')).includes('Meso 9'), 'workout still Meso 9 after new meso');

console.log('6. Rename exercise with planned sets');
await pg.click('nav button[data-v=exercises]'); await pg.waitForTimeout(200);
await pg.locator('.list-item', {hasText:'Hack Squat'}).locator('button').click();
await pg.waitForSelector('#dlg[open]');
await pg.fill('#e-n', 'Hack Squat (Renamed)'); await pg.click('#dlg #k'); await pg.waitForTimeout(250);
db = await state();
ok(db.plan.some(r=>r.ex==='Hack Squat (Renamed)') && !db.plan.some(r=>r.ex==='Hack Squat'), 'rename propagated to planned sets');
ok(!db.sets.some(r=>r.ex==='Hack Squat'), 'rename propagated to history');

console.log('7. Long exercise name: no horizontal overflow');
await pg.click('nav button[data-v=exercises]'); await pg.waitForTimeout(100);
await pg.locator('main > button.btn').click(); await pg.waitForSelector('#dlg[open]');
await pg.fill('#e-n', 'Single-Arm Cross-Body Cable Rear Delt Flye (Kneeling, Rope Attachment, Slow Eccentric)');
await pg.click('#dlg #k'); await pg.waitForTimeout(200);
const overflow = await pg.evaluate(()=>document.documentElement.scrollWidth > window.innerWidth + 1);
ok(!overflow, 'page does not scroll horizontally');

console.log('9. CSV import: twice in a row');
await pg.click('nav button[data-v=settings]'); await pg.waitForTimeout(200);
let [ch] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#b-csv')]);
await ch.setFiles(CSV_PATH); await pg.waitForTimeout(400);
ok(/Imported 2 sets/.test(alerts[alerts.length-1]), 'first import adds exactly 2', alerts[alerts.length-1]);
[ch] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#b-csv')]);
await ch.setFiles(CSV_PATH); await pg.waitForTimeout(400);
ok(/Imported 0 sets/.test(alerts[alerts.length-1]), 'second import adds 0 (idempotent)', alerts[alerts.length-1]);

console.log('10. Backup round-trip');
const pre = await state();
const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#b-exp')]);
const bpath = await dl.path();
await pg.click('#b-reset'); await pg.waitForTimeout(300);
ok(await pg.locator('#b-restore').count()===1, 'erase returns to first-run');
[ch] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#b-restore')]);
await ch.setFiles(bpath); await pg.waitForTimeout(400);
const post = await state();
ok(post.sets.length===pre.sets.length && post.plan.length===pre.plan.length, 'restore identical', `${post.sets.length} vs ${pre.sets.length}`);

console.log('11. Empty start: new meso with no history');
await pg.evaluate(()=>localStorage.removeItem('liftlog.v1'));
await pg.reload(); await pg.click('#b-empty'); await pg.waitForTimeout(200);
await pg.click('nav button[data-v=plan]'); await pg.waitForTimeout(200);
await pg.click('main > button'); await pg.waitForSelector('#dlg[open]');
const nAlerts = alerts.length;
await pg.click('#dlg #k'); await pg.waitForTimeout(300);
ok(alerts.length>nAlerts && /No previous meso/.test(alerts[alerts.length-1]), 'graceful alert, no crash');
await pg.click('#dlg #c'); await pg.waitForTimeout(100);

console.log('12. Storage-full path');
await pg.evaluate(()=>{ const o=Storage.prototype.setItem; Storage.prototype.setItem=function(){ Storage.prototype.setItem=o; throw new Error('QuotaExceededError'); }; });
await pg.click('nav button[data-v=exercises]'); await pg.waitForTimeout(100);
await pg.locator('main > button.btn').click(); await pg.waitForSelector('#dlg[open]');
await pg.fill('#e-n','Quota Test'); const nA=alerts.length; await pg.click('#dlg #k'); await pg.waitForTimeout(200);
ok(alerts.length>nA && /storage may be full/.test(alerts[alerts.length-1]), 'save failure surfaces a warning');
ok((await pg.locator('#hd-title').count())===1, 'app still responsive after failed save');

ok(errors.length===0, 'no page errors anywhere', errors.join(' | '));

await browser.close(); server.close();
console.log(`\n${failed? '❌' : '✅'} ${passed} passed, ${failed} failed`);
process.exit(failed?1:0);
