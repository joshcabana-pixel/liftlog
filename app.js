/* Lift Log — phase 1: logging, exercises, backup. Data stays in this browser. */
'use strict';

const KEY = 'liftlog.v1';
const JOINT = ['None','Low','Moderate','A lot'];
const PUMP  = ['Low','Moderate','Amazing'];
const SORE  = ['None','A little','Healed on time','Still sore'];
const VOL   = ['Not enough','Just right','Pushed my limits','Too much'];
const SKIP  = ['Equipment busy','Out of time','Pain',"Didn't want to"];

let db = null;          // {exercises, sets, plan, currentMeso, schema}
let view = 'workout';

/* ---------- storage ---------- */
function load(){ try{ db = JSON.parse(localStorage.getItem(KEY)); }catch(e){ db = null; } }
function save(){ try{ localStorage.setItem(KEY, JSON.stringify(db)); }catch(e){ alert('Save failed — storage may be full. Export a backup from Settings.'); } }
function today(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

/* ---------- lookups: last two results for an exercise+set ---------- */
function lastTwo(ex, setN, day, meso, self){
  const same=[], any=[];
  const S = db.sets;
  for(let i=S.length-1; i>=0 && (same.length<2 || any.length<2); i--){
    const r = S[i];
    if(r===self || r.ex!==ex || r.set!==setN || r.w==null || r.r==null) continue;
    if(any.length<2) any.push(r);
    if(same.length<2 && r.day===day && r.meso===meso) same.push(r);
  }
  // prefer same-day-in-meso matches (sheet behaviour), fall back to any day
  const pick = same.length ? same : any;
  if(same.length===1 && any.length>1){
    const extra = any.find(r=>r!==same[0]);
    if(extra) pick.push(extra);
  }
  return pick; // newest first, 0..2 entries
}
function fmt(r){ return r ? `<b>${r.w} × ${r.r}</b>` : 'None'; }

/* ---------- workout selection ---------- */
function dayKey(r){ return r.meso+'|'+r.wk+'|'+r.day; }
function currentWorkout(){
  if(!db.plan.length) return null;
  const first = db.plan.reduce((a,b)=> (a.wk,a.day)<=(b.wk,b.day) ? a : b, db.plan[0]);
  // plan is stored in order; take the first row's day
  const k = dayKey(db.plan[0]);
  const rows = db.plan.filter(r=>dayKey(r)===k);
  return {key:k, meso:rows[0].meso, wk:rows[0].wk, day:rows[0].day, label:rows[0].label,
          rir:rows[0].rir, rows};
}

/* ---------- render helpers ---------- */
const $ = s => document.querySelector(s);
function el(html){ const t=document.createElement('template'); t.innerHTML=html.trim(); return t.content.firstChild; }
function pills(opts, sel, cb){
  const wrap=document.createElement('span');
  opts.forEach(o=>{
    const b=el(`<button class="pill${o===sel?' sel':''}">${o}</button>`);
    b.onclick=()=>cb(o===sel?null:o);
    wrap.appendChild(b);
  });
  return wrap;
}

/* ---------- views ---------- */
function render(){
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on', b.dataset.v===view));
  const m=$('#main'); m.innerHTML='';
  if(!db){ renderSetup(m); return; }
  ({workout:renderWorkout, plan:renderPlan, exercises:renderExercises, settings:renderSettings,
    history:renderHistory, insights:renderInsights})[view](m);
}

function renderSetup(m){
  $('#hd-title').textContent='Lift Log'; $('#hd-sub').textContent='First run';
  m.appendChild(el(`<div class="card"><h2>Set up your data</h2>
    <div class="meta">Restore your history from a backup file (saved in Files or iCloud), or start empty.</div>
    <button class="btn" id="b-seed" style="display:none">Load my RP data</button>
    <button class="btn" id="b-restore">Restore from a backup file</button>
    <button class="btn ghost" id="b-empty">Start empty</button></div>`));
  // seed data is a local/dev-only file (not published); show the button only if it exists
  fetch('data/seed.json', {method:'HEAD'}).then(r=>{
    if(r.ok && $('#b-seed')){ $('#b-seed').style.display='block'; $('#b-restore').className='btn ghost'; }
  }).catch(()=>{});
  $('#b-seed').onclick = async ()=>{
    try{
      const r = await fetch('data/seed.json'); db = await r.json();
      save(); render();
    }catch(e){ alert('Could not load seed data: '+e.message); }
  };
  $('#b-restore').onclick = importBackup;
  $('#b-empty').onclick = ()=>{ db={schema:1, exercises:[], sets:[], plan:[], currentMeso:null}; save(); render(); };
}

function renderWorkout(m){
  const w = currentWorkout();
  $('#hd-title').textContent = w ? `${w.meso.replace(/ -.*/,'')} · Week ${w.wk} · ${w.label}` : 'Workout';
  $('#hd-sub').textContent = w ? (w.rir==='Deload' ? 'Deload week — light and easy' : `Target ${w.rir} RIR — pick weights from your last two results`) : '';
  if(!w){ m.appendChild(el(`<div class="empty">No planned sets left in this meso.<br>Build the next one from the Meso tab.</div>`)); return; }

  // group rows by exercise, preserving order
  const order=[], byEx={};
  w.rows.forEach(r=>{ if(!byEx[r.ex]){ byEx[r.ex]=[]; order.push(r.ex); } byEx[r.ex].push(r); });
  // which exercises already have done sets today (for undo display)
  const doneToday = db.sets.filter(r=>r.meso===w.meso && r.wk===w.wk && r.day===w.day);
  const firstOfMuscle = {};
  order.forEach(ex=>{ const mu=byEx[ex][0].muscle; if(!(mu in firstOfMuscle)) firstOfMuscle[mu]=ex; });

  order.forEach(ex=>{
    const rows = byEx[ex];
    const mu = rows[0].muscle;
    const card = el(`<div class="card"><div class="exhead"><h2>${ex}</h2><span class="muscle">${mu}</span></div></div>`);
    const doneRows = doneToday.filter(r=>r.ex===ex);
    const all = [...doneRows, ...rows].sort((a,b)=>a.set-b.set);
    all.forEach(r=>{
      const done = r.w!=null || r.skip;
      const [l1,l2] = lastTwo(ex, r.set, w.day, w.meso, r);
      const row = el(`<div class="setrow${r.w!=null?' done':''}${r.skip?' skipped':''}">
        <div class="n">${r.set}</div>
        <div class="hist">${r.skip ? 'Skipped — '+r.skip : `Last ${fmt(l1)}<br>Before ${fmt(l2)}`}</div>
        <input type="number" inputmode="decimal" placeholder="${l1?l1.w:'wt'}" value="${r.w??''}" ${r.skip?'disabled':''}>
        <input type="number" inputmode="numeric" placeholder="${l1?l1.r:'reps'}" value="${r.r??''}" ${r.skip?'disabled':''}>
        <button class="ok">${r.w!=null?'✓':(r.skip?'↺':'✓')}</button></div>`);
      const [wi, ri] = row.querySelectorAll('input');
      row.querySelector('.ok').onclick = ()=>{
        if(r.skip){ unskipSet(r); return; }
        if(r.w!=null){ undoSet(r); return; }
        const wv=parseFloat(wi.value), rv=parseInt(ri.value,10);
        if(isNaN(wv)||isNaN(rv)){ askSkip(r); return; }
        logSet(r, wv, rv);
      };
      card.appendChild(row);
    });
    // feedback: joint pain per exercise; muscle feedback on first exercise of muscle
    const fb = el(`<div class="fb"></div>`);
    const anchor = doneRows.find(r=>r.set===1) || doneRows[0];
    const fbRow=(lab,opts,field)=>{
      const line=el(`<div class="pillrow"><span class="lab">${lab}</span></div>`);
      line.appendChild(pills(opts, anchor?anchor[field]:null, v=>{ if(anchor){ anchor[field]=v||undefined; save(); render(); } else alert('Log a set first.'); }));
      return line;
    };
    fb.appendChild(fbRow('Joint pain', JOINT, 'joint'));
    if(firstOfMuscle[mu]===ex){
      fb.appendChild(fbRow('Pump', PUMP, 'pump'));
      fb.appendChild(fbRow('Soreness', SORE, 'sore'));
      fb.appendChild(fbRow('Volume', VOL, 'vol'));
    }
    card.appendChild(fb);
    m.appendChild(card);
  });
  m.appendChild(el(`<button class="btn ghost" id="b-skipday">Skip the rest of this workout…</button>`));
  $('#b-skipday').onclick = ()=>askSkip(null, w);
}

function logSet(r, wv, rv){
  db.plan = db.plan.filter(x=>x!==r);
  db.sets.push({...r, w:wv, r:rv, date:today()});
  save(); render();
}
function undoSet(r){
  db.sets = db.sets.filter(x=>x!==r);
  delete r.w; delete r.r; delete r.date;
  db.plan.push(r); sortPlan(); save(); render();
}
function unskipSet(r){
  db.sets = db.sets.filter(x=>x!==r);
  delete r.skip; delete r.date;
  db.plan.push(r); sortPlan(); save(); render();
}
function sortPlan(){
  // keep mesos in their existing order (finish the current one before a newly created one)
  const seen=[];
  db.plan.forEach(r=>{ if(!seen.includes(r.meso)) seen.push(r.meso); });
  db.plan.sort((a,b)=> seen.indexOf(a.meso)-seen.indexOf(b.meso) || a.wk-b.wk || a.day-b.day || 0);
}
function askSkip(r, wholeDay){
  const d=$('#dlg');
  d.innerHTML = `<h3>${wholeDay?'Skip remaining sets?':'Skip this set?'}</h3>
    <div class="field"><label>Reason</label><select id="sk">${SKIP.map(s=>`<option>${s}</option>`).join('')}</select></div>
    <div class="row2"><button class="btn ghost" id="c">Cancel</button><button class="btn" id="k">Skip</button></div>`;
  d.showModal();
  d.querySelector('#c').onclick=()=>d.close();
  d.querySelector('#k').onclick=()=>{
    const reason=d.querySelector('#sk').value;
    const rows = wholeDay ? [...wholeDay.rows] : [r];
    rows.forEach(x=>{ db.plan=db.plan.filter(p=>p!==x); db.sets.push({...x, skip:reason, date:today()}); });
    save(); d.close(); render();
  };
}

function renderPlan(m){
  $('#hd-title').textContent='Meso plan'; $('#hd-sub').textContent=db.currentMeso||'';
  const nb=el('<button class="btn ghost" style="margin-bottom:12px">Start next meso (copy this one)</button>');
  nb.onclick=newMesoDialog; m.appendChild(nb);
  if(!db.plan.length){ m.appendChild(el(`<div class="empty">Nothing planned — start the next meso above.</div>`)); return; }
  const days={}, order=[];
  db.plan.forEach(r=>{ const k=dayKey(r); if(!days[k]){days[k]={rows:[],r};order.push(k);} days[k].rows.push(r); });
  order.forEach(k=>{
    const d=days[k], r=d.r;
    const byEx={}, exOrder=[];
    d.rows.forEach(x=>{ if(!byEx[x.ex])exOrder.push(x.ex); byEx[x.ex]=(byEx[x.ex]||0)+1; });
    const card=el(`<div class="card"><h2>Week ${r.wk} · ${r.label}</h2>
      <div class="meta">${r.rir==='Deload'?'Deload':'Target '+r.rir+' RIR'} · ${d.rows.length} sets</div></div>`);
    exOrder.forEach(ex=>{
      const row=el(`<div class="list-item"><span>${ex}</span><span class="l2" style="display:flex;gap:6px;align-items:center">
        <button class="btn ghost small" data-a="-">−</button><b style="color:var(--text)">${byEx[ex]}</b><button class="btn ghost small" data-a="+">+</button></span></div>`);
      row.querySelector('[data-a="+"]').onclick=()=>{
        const tpl=d.rows.filter(x=>x.ex===ex);
        db.plan.push({...tpl[0], set:Math.max(...tpl.map(x=>x.set))+1}); sortPlan(); save(); render();
      };
      row.querySelector('[data-a="-"]').onclick=()=>{
        const tpl=d.rows.filter(x=>x.ex===ex);
        if(!tpl.length) return;
        const last=tpl.reduce((a,b)=>b.set>a.set?b:a,tpl[0]);
        db.plan=db.plan.filter(x=>x!==last); save(); render();
      };
      card.appendChild(row);
    });
    const add=el('<button class="skiplink">Add an exercise to this day…</button>');
    add.onclick=()=>addToDay(r);
    card.appendChild(add);
    m.appendChild(card);
  });
}
function addToDay(ref){
  const d=$('#dlg');
  const names=db.exercises.filter(e=>!e.archived).map(e=>e.name).sort();
  d.innerHTML=`<h3>Add to Week ${ref.wk} · ${ref.label}</h3>
    <div class="field"><label>Exercise</label><select id="a-e">${names.map(n=>`<option>${n}</option>`).join('')}</select></div>
    <div class="field"><label>Sets</label><select id="a-s">${[1,2,3,4,5].map(x=>`<option${x===2?' selected':''}>${x}</option>`).join('')}</select></div>
    <div class="field"><label><input type="checkbox" id="a-w" checked style="width:auto"> Also add to the remaining weeks of this meso</label></div>
    <div class="row2"><button class="btn ghost" id="c">Cancel</button><button class="btn" id="k">Add</button></div>`;
  d.showModal();
  d.querySelector('#c').onclick=()=>d.close();
  d.querySelector('#k').onclick=()=>{
    const ex=d.querySelector('#a-e').value, n=parseInt(d.querySelector('#a-s').value,10);
    const allWeeks=d.querySelector('#a-w').checked;
    const exInfo=db.exercises.find(e=>e.name===ex);
    const targets={};
    db.plan.forEach(r=>{
      if(r.meso!==ref.meso || r.day!==ref.day) return;
      if(!allWeeks && r.wk!==ref.wk) return;
      if(r.wk<ref.wk) return;
      targets[r.wk]=r;
    });
    Object.values(targets).forEach(t=>{
      const have=db.plan.filter(x=>x.meso===t.meso&&x.wk===t.wk&&x.day===t.day&&x.ex===ex).length;
      const want=t.rir==='Deload'?Math.max(1,Math.floor(n/2)):n;
      for(let s=have+1;s<=have+want;s++)
        db.plan.push({meso:t.meso, wk:t.wk, day:t.day, label:t.label, muscle:exInfo?exInfo.muscle:'', ex, set:s, rir:t.rir});
    });
    sortPlan(); save(); d.close(); render();
  };
}
function newMesoDialog(){
  const d=$('#dlg');
  const src=db.currentMeso;
  const n=(src&&src.match(/\d+/))?parseInt(src.match(/\d+/)[0],10)+1:1;
  d.innerHTML=`<h3>Start next meso</h3>
    <div class="field"><label>Name</label><input id="m-n" value="Meso ${n}"></div>
    <div class="field"><label>Weeks (last week = deload)</label><select id="m-w">${[4,5,6,7].map(x=>`<option${x===6?' selected':''}>${x}</option>`).join('')}</select></div>
    <div class="meta">Copies days, exercises and set counts from ${src||'the last meso'}'s final full week. RIR runs down to 0, then deload.</div>
    <div class="row2"><button class="btn ghost" id="c">Cancel</button><button class="btn" id="k">Create</button></div>`;
  d.showModal();
  d.querySelector('#c').onclick=()=>d.close();
  d.querySelector('#k').onclick=()=>{
    const name=d.querySelector('#m-n').value.trim()||('Meso '+n);
    const weeks=parseInt(d.querySelector('#m-w').value,10);
    // reference = last non-deload week of current meso with rows (plan or sets)
    const all=[...db.sets,...db.plan].filter(r=>r.meso===src && r.rir!=='Deload');
    if(!all.length){ alert('No previous meso to copy.'); return; }
    const refWk=Math.max(...all.map(r=>r.wk));
    const ref=all.filter(r=>r.wk===refWk).sort((a,b)=>a.day-b.day||a.set-b.set);
    // RIR pattern: e.g. 6 weeks -> 3,2,2,1,0,Deload (RP's observed pattern)
    const rirs=[]; const work=weeks-1;
    for(let i=0;i<work;i++){ rirs.push(Math.max(0, Math.round(3-(3*i/Math.max(1,work-1))))); }
    rirs.push('Deload');
    const rows=[];
    for(let w=1;w<=weeks;w++){
      const rir=rirs[w-1], deload=rir==='Deload';
      const counts={};
      ref.forEach(r=>{
        const k=r.day+'|'+r.ex;
        counts[k]=counts[k]||{n:0,r};
        counts[k].n++;
      });
      Object.values(counts).forEach(({n,r})=>{
        const sets=deload?Math.max(1,Math.floor(n/2)):n;
        for(let s=1;s<=sets;s++)
          rows.push({meso:name, wk:w, day:r.day, label:r.label, muscle:r.muscle, ex:r.ex, set:s, rir});
      });
    }
    rows.sort((a,b)=>a.wk-b.wk||a.day-b.day);
    db.plan.push(...rows); sortPlan(); db.currentMeso=name;
    save(); d.close(); render();
  };
}

function renderExercises(m){
  $('#hd-title').textContent='Exercises'; $('#hd-sub').textContent=db.exercises.length+' exercises';
  const btn=el(`<button class="btn" style="margin-bottom:12px">Add exercise</button>`);
  btn.onclick=()=>editExercise(null);
  m.appendChild(btn);
  const card=el(`<div class="card"></div>`);
  [...db.exercises].sort((a,b)=>a.name.localeCompare(b.name)).forEach(ex=>{
    const n = db.sets.filter(r=>r.ex===ex.name && r.w!=null).length;
    const row=el(`<div class="list-item"><div><div>${ex.name}${ex.archived?' <span class="l2">(archived)</span>':''}</div>
      <div class="l2">${ex.muscle} · ${ex.equipment} · ${n} sets logged</div></div><button class="btn ghost small">Edit</button></div>`);
    row.querySelector('button').onclick=()=>editExercise(ex);
    card.appendChild(row);
  });
  m.appendChild(card);
}
function editExercise(ex){
  const d=$('#dlg');
  const muscles=['Chest','Back','Triceps','Biceps','Shoulders','Quads','Glutes','Hamstrings','Calves','Traps','Forearms','Abs'];
  const equip=['Machine','Barbell','Dumbbell','Cable','Bodyweight'];
  d.innerHTML=`<h3>${ex?'Edit':'New'} exercise</h3>
    <div class="field"><label>Name</label><input id="e-n" value="${ex?ex.name:''}"></div>
    <div class="field"><label>Focus muscle</label><select id="e-m">${muscles.map(x=>`<option${ex&&ex.muscle===x?' selected':''}>${x}</option>`).join('')}</select></div>
    <div class="field"><label>Type</label><select id="e-e">${equip.map(x=>`<option${ex&&ex.equipment===x?' selected':''}>${x}</option>`).join('')}</select></div>
    ${ex?`<div class="field"><label><input type="checkbox" id="e-a" ${ex.archived?'checked':''} style="width:auto"> Archived</label></div>`:''}
    <div class="row2"><button class="btn ghost" id="c">Cancel</button><button class="btn" id="k">Save</button></div>`;
  d.showModal();
  d.querySelector('#c').onclick=()=>d.close();
  d.querySelector('#k').onclick=()=>{
    const name=d.querySelector('#e-n').value.trim();
    if(!name){ alert('Name required'); return; }
    if(ex){
      if(name!==ex.name){ db.sets.forEach(r=>{if(r.ex===ex.name)r.ex=name;}); db.plan.forEach(r=>{if(r.ex===ex.name)r.ex=name;}); }
      ex.name=name; ex.muscle=d.querySelector('#e-m').value; ex.equipment=d.querySelector('#e-e').value;
      ex.archived=d.querySelector('#e-a')?.checked||false;
    }else{
      db.exercises.push({name, muscle:d.querySelector('#e-m').value, equipment:d.querySelector('#e-e').value, archived:false});
    }
    save(); d.close(); render();
  };
}

function renderSettings(m){
  $('#hd-title').textContent='Settings';
  const done=db.sets.filter(r=>r.w!=null).length;
  $('#hd-sub').textContent=`${done} sets logged · ${db.plan.length} planned`;
  m.appendChild(el(`<div class="banner">Your data lives only on this phone. <b>Export a backup</b> after workouts and save it to iCloud or Drive.</div>`));
  const c=el(`<div class="card">
    <button class="btn" id="b-exp">Export backup</button>
    <button class="btn ghost" id="b-imp">Import backup</button>
    <button class="btn ghost" id="b-csv">Import sets from the Google Sheet (CSV)</button>
    <button class="btn ghost" id="b-reset" style="color:#e06c6c">Erase all data…</button></div>
    <div class="banner">Sheet import: in Google Sheets open the <b>Log</b> tab, File → Download → CSV, then pick that file here. Sets you logged in the sheet are added; nothing is overwritten.</div>`);
  m.appendChild(c);
  $('#b-csv').onclick=importSheetCsv;
  $('#b-exp').onclick=()=>{
    const blob=new Blob([JSON.stringify(db)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=`liftlog-backup-${today()}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  $('#b-imp').onclick=importBackup;
  $('#b-reset').onclick=()=>{
    if(confirm('Erase everything on this phone? Export a backup first if you want to keep it.')){
      localStorage.removeItem(KEY); db=null; render();
    }
  };
}
function parseCsv(text){
  const rows=[]; let row=[], cell='', q=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(q){ if(ch==='"'){ if(text[i+1]==='"'){cell+='"';i++;} else q=false; } else cell+=ch; }
    else if(ch==='"') q=true;
    else if(ch===','){ row.push(cell); cell=''; }
    else if(ch==='\n'||ch==='\r'){ if(ch==='\r'&&text[i+1]==='\n')i++; row.push(cell); rows.push(row); row=[]; cell=''; }
    else cell+=ch;
  }
  if(cell!==''||row.length){ row.push(cell); rows.push(row); }
  return rows;
}
function importSheetCsv(){
  const i=document.createElement('input'); i.type='file'; i.accept='.csv,text/csv';
  i.onchange=async()=>{
    try{
      const rows=parseCsv(await i.files[0].text());
      const hd=rows[0].map(h=>h.trim().toLowerCase());
      const col=n=>hd.findIndex(h=>h===n || h.startsWith(n));
      const C={ex:col('exercise'), set:col('set'), rir:col('rir'), w:col('weight'), r:col('reps'),
        skip:col('skip reason'), date:col('date'), joint:col('joint pain'), pump:col('pump'),
        sore:col('soreness'), vol:col('volume'), note:col('notes'), meso:col('meso'),
        wk:col('week'), day:hd.lastIndexOf('day'), label:col('day label'), muscle:col('muscle')};
      if(C.ex<0||C.meso<0||C.wk<0) throw new Error('this is not the Log tab CSV (headers missing)');
      let added=0, dup=0;
      const key=r=>[r.meso,r.wk,r.day,r.ex,r.set].join('|');
      const have=new Set(db.sets.map(key));
      rows.slice(1).forEach(c=>{
        const w=parseFloat(c[C.w]), r=parseInt(c[C.r],10), skip=(c[C.skip]||'').trim();
        if(isNaN(w)&&!skip) return;                    // nothing logged on this row
        const rec={meso:c[C.meso].trim(), wk:parseInt(c[C.wk],10), day:parseInt(c[C.day],10),
          label:(c[C.label]||'').trim(), muscle:(c[C.muscle]||'').trim(),
          ex:c[C.ex].trim(), set:parseInt(c[C.set],10)};
        if(!rec.meso||!rec.ex||isNaN(rec.wk)||isNaN(rec.set)) return;
        if(have.has(key(rec))){ dup++; return; }
        const rir=(c[C.rir]||'').trim();
        rec.rir = rir==='Deload' ? 'Deload' : (rir===''?undefined:parseInt(rir,10));
        if(!isNaN(w)){ rec.w=w; rec.r=isNaN(r)?0:r; } else rec.skip=skip;
        const dt=(c[C.date]||'').trim();
        if(dt){ const mch=dt.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
          if(mch){ const y=mch[3].length===2?'20'+mch[3]:mch[3];
            rec.date=`${y}-${mch[1].padStart(2,'0')}-${mch[2].padStart(2,'0')}`; } else rec.date=dt; }
        ['joint','pump','sore','vol','note'].forEach(f=>{ const v=(c[C[f]]||'').trim(); if(v) rec[f]=v; });
        db.plan=db.plan.filter(p=>key(p)!==key(rec));   // row is now logged, not planned
        db.sets.push(rec); have.add(key(rec)); added++;
      });
      save(); render();
      alert(`Imported ${added} sets${dup?` (${dup} already here, skipped)`:''}.`);
    }catch(e){ alert('Import failed: '+e.message); }
  };
  i.click();
}
function importBackup(){
  const i=document.createElement('input'); i.type='file'; i.accept='.json,application/json';
  i.onchange=async()=>{
    try{
      const d=JSON.parse(await i.files[0].text());
      if(!d.schema || !Array.isArray(d.sets)) throw new Error('not a Lift Log backup');
      db=d; save(); render();
    }catch(e){ alert('Import failed: '+e.message); }
  };
  i.click();
}

/* ---------- history ---------- */
let histEx = null;
function renderHistory(m){
  $('#hd-title').textContent='History';
  const names=[...new Set(db.sets.filter(r=>r.w!=null).map(r=>r.ex))].sort();
  if(!histEx || !names.includes(histEx)) histEx=names[0]||null;
  $('#hd-sub').textContent = histEx ? '' : 'No logged sets yet';
  if(!histEx) { m.appendChild(el('<div class="empty">Log a workout first.</div>')); return; }
  const sel=el(`<select style="margin-bottom:12px">${names.map(n=>`<option${n===histEx?' selected':''}>${n}</option>`).join('')}</select>`);
  sel.onchange=()=>{ histEx=sel.value; render(); };
  m.appendChild(sel);

  // one point per session: top set (max weight, then max reps at that weight)
  const byDate={};
  db.sets.forEach(r=>{
    if(r.ex!==histEx || r.w==null || !r.date) return;
    (byDate[r.date]=byDate[r.date]||[]).push(r);
  });
  const sessions=Object.keys(byDate).sort().map(d=>{
    const rows=byDate[d];
    const top=rows.reduce((a,b)=> b.w>a.w || (b.w===a.w && b.r>a.r) ? b : a, rows[0]);
    return {date:d, top, rows, deload:rows[0].rir==='Deload'};
  });
  m.appendChild(chartCard(sessions));

  // session list, newest first, with break markers
  const card=el('<div class="card"></div>');
  const list=[...sessions].reverse();
  list.forEach((s,i)=>{
    const prev=list[i+1];
    if(prev){
      const gap=Math.round((new Date(s.date)-new Date(prev.date))/864e5);
      if(gap>21) card.appendChild(el(`<div class="list-item"><span class="l2">— break: ${Math.round(gap/7)} weeks —</span></div>`));
    }
    const setsTxt=byDate[s.date].sort((a,b)=>a.set-b.set).map(r=>`${r.w}×${r.r}`).join(' · ');
    card.appendChild(el(`<div class="list-item"><div><div>${fmtDate(s.date)}${s.deload?' <span class="l2">(deload)</span>':''}</div>
      <div class="l2">${setsTxt}</div></div><span class="l2">${s.rows[0].meso.replace(/ [-(].*/,'')}</span></div>`));
  });
  m.appendChild(card);
}
function fmtDate(d){ const t=new Date(d+'T12:00'); return t.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}); }
function chartCard(sessions){
  const W=520,H=200,P=28;
  if(sessions.length<2) return el('<div class="banner">Not enough sessions to chart yet.</div>');
  const xs=sessions.map(s=>+new Date(s.date));
  const ws=sessions.map(s=>s.top.w);
  const x0=Math.min(...xs), x1=Math.max(...xs), w0=Math.min(...ws), w1=Math.max(...ws);
  const X=t=>P+(W-2*P)*(x1===x0?0.5:(t-x0)/(x1-x0));
  const Y=v=>H-P-(H-2*P)*(w1===w0?0.5:(v-w0)/(w1-w0));
  let path='', pts='';
  sessions.forEach((s,i)=>{
    const x=X(xs[i]), y=Y(s.top.w);
    path+=(i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1);
    pts+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${s.deload?'#e5a84b':'#4cc38a'}"><title>${s.date}: ${s.top.w}×${s.top.r}</title></circle>`;
  });
  return el(`<div class="card"><div class="meta">Top set weight · <span style="color:#4cc38a">●</span> normal <span style="color:#e5a84b">●</span> deload</div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Top set weight over time">
    <text x="${P}" y="14" fill="#8b97a3" font-size="11">${w1}</text>
    <text x="${P}" y="${H-P-6}" fill="#8b97a3" font-size="11">${w0}</text>
    <text x="${W-P}" y="${H-6}" fill="#8b97a3" font-size="11" text-anchor="end">${fmtDate(sessions[sessions.length-1].date)}</text>
    <text x="${P}" y="${H-6}" fill="#8b97a3" font-size="11">${fmtDate(sessions[0].date)}</text>
    <path d="${path}" fill="none" stroke="#4cc38a" stroke-width="2" opacity=".85"/>${pts}</svg></div>`);
}

/* ---------- insights ---------- */
function renderInsights(m){
  $('#hd-title').textContent='Insights';
  const dates=[...new Set(db.sets.filter(r=>r.w!=null&&r.date).map(r=>r.date))].sort();
  $('#hd-sub').textContent=dates.length+' workouts all-time';
  if(!dates.length){ m.appendChild(el('<div class="empty">Log a workout first.</div>')); return; }
  const now=new Date(), day=864e5;
  const inLast=n=>dates.filter(d=>now-new Date(d)<=n*day).length;
  const stat=(lab,val,sub)=>`<div class="list-item"><div><div>${lab}</div>${sub?`<div class="l2">${sub}</div>`:''}</div><b>${val}</b></div>`;

  // streak: consecutive calendar weeks (back from this week) with ≥1 workout
  const wk=d=>{ const t=new Date(d+'T12:00'); const on=(t.getDay()+6)%7; t.setDate(t.getDate()-on); return t.toISOString().slice(0,10); };
  const weeks=new Set(dates.map(wk));
  let streak=0; const cur=new Date();
  for(;;){ const key=wk(cur.toISOString().slice(0,10)); if(weeks.has(key)) streak++; else if(streak>0||key!==wk(now.toISOString().slice(0,10))) break; cur.setDate(cur.getDate()-7); if(streak>520) break; }

  const c1=el(`<div class="card"><h2>Frequency</h2>
    ${stat('This week', inLast(now.getDay()===0?7:(now.getDay()+6)%7+1))}
    ${stat('Per week', (inLast(28)/4).toFixed(1), 'last 4 weeks')}
    ${stat('Per week', (inLast(91)/13).toFixed(1), 'last quarter')}
    ${stat('Per week', (inLast(365)/52).toFixed(1), 'last year')}
    ${stat('Week streak', streak, 'weeks in a row with a workout')}</div>`);
  m.appendChild(c1);

  // skips: current meso, by exercise; flag 3+ consecutive
  const cm=db.currentMeso;
  const skips={}, lastRuns={};
  db.sets.filter(r=>r.meso===cm).forEach(r=>{ if(r.skip){ skips[r.ex]=(skips[r.ex]||0)+1; } });
  // consecutive skipped sessions per exercise (latest sessions of that exercise in current meso)
  const exSessions={};
  db.sets.filter(r=>r.meso===cm).forEach(r=>{
    const k=r.ex+'|'+r.wk+'|'+r.day;
    exSessions[r.ex]=exSessions[r.ex]||{};
    const s=exSessions[r.ex][k]=exSessions[r.ex][k]||{wk:r.wk,day:r.day,any:false,done:false};
    s.any=true; if(r.w!=null) s.done=true;
  });
  Object.entries(exSessions).forEach(([ex,ss])=>{
    const ordered=Object.values(ss).sort((a,b)=>a.wk-b.wk||a.day-b.day);
    let run=0; ordered.forEach(s=>{ run = s.done ? 0 : run+1; });
    lastRuns[ex]=run;
  });
  // deload & break effects: est. strength (Epley w*(1+r/30)) first session after vs last before
  const epley=r=>r.w*(1+r.r/30);
  const perEx={};
  db.sets.forEach(r=>{
    if(r.w==null||!r.date) return;
    const k=r.ex+'|'+r.date;
    perEx[r.ex]=perEx[r.ex]||{};
    const s=perEx[r.ex][r.date]=perEx[r.ex][r.date]||{best:0,deload:false};
    s.best=Math.max(s.best,epley(r)); if(r.rir==='Deload')s.deload=true;
  });
  const dl=[], br=[];
  Object.values(perEx).forEach(byDate=>{
    const ss=Object.entries(byDate).sort((a,b)=>a[0]<b[0]?-1:1).map(([d,v])=>({d,...v}));
    for(let i=1;i<ss.length;i++){
      const gap=(new Date(ss[i].d)-new Date(ss[i-1].d))/864e5;
      if(gap>21 && !ss[i].deload && !ss[i-1].deload) br.push(ss[i].best/ss[i-1].best-1);
      if(ss[i-1].deload && !ss[i].deload){
        // compare vs last normal session before the deload block
        let j=i-1; while(j>=0 && ss[j].deload) j--;
        if(j>=0) dl.push(ss[i].best/ss[j].best-1);
      }
    }
  });
  const med=a=>{ if(!a.length)return null; const s=[...a].sort((x,y)=>x-y); return s[Math.floor(s.length/2)]; };
  const pct=v=>v==null?'—':(v>=0?'+':'')+(v*100).toFixed(1)+'%';
  const c3=el(`<div class="card"><h2>Deloads &amp; breaks</h2>
    <div class="meta">Est. strength (weight × reps, Epley) in the first session back vs the last one before.</div>
    ${stat('After a deload', pct(med(dl)), dl.length+' exercise rebounds measured')}
    ${stat('After a 3+ week break', pct(med(br)), br.length+' returns measured')}</div>`);
  m.appendChild(c3);

  const skipRows=Object.entries(skips).sort((a,b)=>b[1]-a[1]);
  const c2=el(`<div class="card"><h2>Skips this meso</h2><div class="meta">${cm||''}</div>
    ${skipRows.length?skipRows.map(([ex,n])=>stat(ex, n+' sets', lastRuns[ex]>=2?`skipped last ${lastRuns[ex]} sessions — replace it or move it to another day?`:'' )).join(''):'<div class="l2" style="padding:8px 2px">No skipped sets yet.</div>'}</div>`);
  m.appendChild(c2);
}

/* ---------- boot ---------- */
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{view=b.dataset.v; render();});
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
load(); render();
