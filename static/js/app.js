// ========== utils ==========
function $(sel){ return document.querySelector(sel); }
function createEl(tag, cls){ const el = document.createElement(tag); if (cls) el.className = cls; return el; }

function getToken(){ return localStorage.getItem('access_token'); }
function setToken(t){ localStorage.setItem('access_token', t); }
function clearToken(){ localStorage.removeItem('access_token'); }

function decodeJWT(token){
  try{
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g,'+').replace(/_/g,'/'));
    return JSON.parse(decodeURIComponent(escape(json)));
  }catch(e){ return null; }
}
function currentClaims(){ const t = getToken(); return t ? (decodeJWT(t) || {}) : {}; }

function isoLocal(d){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

async function api(path, opts={}){
  const headers = opts.headers || {};
  if (!('Content-Type' in headers) && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const t = getToken(); if (t) headers['Authorization'] = 'Bearer ' + t;
  const res = await fetch(path, { ...opts, headers });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw (data || { error: res.statusText });
  return data;
}

// ========== Auth (index) ==========
(function initAuth(){
  if (!document.body.classList.contains('page-auth')) return;

  // jeśli już zalogowany → Start
  if (getToken()) { window.location.href = '/start'; return; }

  const loginView = $('#login-view');
  const registerView = $('#register-view');
  $('#to-register').addEventListener('click', e => { e.preventDefault(); loginView.classList.add('hidden'); registerView.classList.remove('hidden'); });
  $('#to-login').addEventListener('click', e => { e.preventDefault(); registerView.classList.add('hidden'); loginView.classList.remove('hidden'); });

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const body = { email: form.email.value.trim(), password: form.password.value };
    const msg = $('#login-msg'); msg.textContent = '';
    try{
      const r = await api('/api/login', { method:'POST', body: JSON.stringify(body) });
      setToken(r.access_token); window.location.href = '/start';
    }catch(err){ msg.textContent = (err && err.error) ? err.error : 'Błąd logowania'; }
  });

  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const body = { full_name: form.full_name.value.trim(), email: form.email.value.trim(), password: form.password.value };
    const msg = $('#register-msg'); msg.textContent = '';
    try{
      const r = await api('/api/register', { method:'POST', body: JSON.stringify(body) });
      setToken(r.access_token); window.location.href = '/start';
    }catch(err){ msg.textContent = (err && err.error) ? err.error : 'Błąd rejestracji'; }
  });
})();

// ====== MENU (hamburger) — idempotent ======
function initMenu(){
  const toggle = document.getElementById('menu-toggle');
  const panel  = document.getElementById('menu-panel');
  if (!toggle || !panel) return;
  if (panel.dataset.bound === '1') return; // уже инициализировано
  panel.dataset.bound = '1';

  const claims = (typeof currentClaims === 'function') ? currentClaims() : {};
  const adminLink = document.getElementById('menu-admin');
  if (adminLink) adminLink.hidden = (claims.role !== 'admin');

  function open(){
    panel.hidden = false;
    toggle.setAttribute('aria-expanded','true');
    document.addEventListener('click', onDocClick, {capture:true});
    document.addEventListener('keydown', onEsc);
  }
  function close(){
    panel.hidden = true;
    toggle.setAttribute('aria-expanded','false');
    document.removeEventListener('click', onDocClick, {capture:true});
    document.removeEventListener('keydown', onEsc);
  }
  function onDocClick(e){
    if (e.target === toggle || toggle.contains(e.target)) return;
    if (!panel.contains(e.target)) close();
  }
  function onEsc(e){ if (e.key === 'Escape') close(); }

  toggle.addEventListener('click', (ev)=>{ ev.stopPropagation(); (panel.hidden ? open() : close()); });

  // actions
  document.getElementById('menu-logout')?.addEventListener('click', ()=>{ clearToken(); window.location.href = '/'; });
  document.getElementById('menu-proposals')?.addEventListener('click', ()=>{ if (typeof openProposalsInbox === 'function') openProposalsInbox(); close(); });
}
initMenu();

// ========== Dashboard (calendar only) ==========
let ALL_SHIFTS = [];
let CURRENT = new Date();

async function fetchShifts(){
  const data = await api('/api/my-shifts', { method:'GET' });
  ALL_SHIFTS = data;
  return data;
}
async function fetchDayShifts(isoDate){
  return await api('/api/day-shifts?date=' + encodeURIComponent(isoDate), { method:'GET' });
}

function groupShiftsByDate(shifts){
  const m = new Map();
  for (const s of shifts){
    const k = s.shift_date;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(s);
  }
  return m;
}

function renderCalendar(){
  const el = $('#calendar'); if (!el) return;
  el.innerHTML = '';
  const y = CURRENT.getFullYear(), m = CURRENT.getMonth();
  const firstDay = new Date(y, m, 1), lastDay = new Date(y, m+1, 0);

  const monthTitle = new Intl.DateTimeFormat('pl-PL', { month:'long', year:'numeric' }).format(firstDay);
  $('#month-title').textContent = monthTitle.charAt(0).toUpperCase() + monthTitle.slice(1);

  const weekNames = ['Pn','Wt','Śr','Cz','Pt','So','Nd'];
  for (const w of weekNames){ const h = createEl('div','cell weekday'); h.textContent = w; el.appendChild(h); }

  const startOffset = (firstDay.getDay() + 6) % 7;
  const totalCells = startOffset + lastDay.getDate();
  const rows = Math.ceil(totalCells / 7);

  const byDate = groupShiftsByDate(ALL_SHIFTS);

  for (let i=0;i<rows*7;i++){
    const cell = createEl('div','cell day');
    const dayNum = i - startOffset + 1;

    if (dayNum>=1 && dayNum<=lastDay.getDate()){
      const d = new Date(y, m, dayNum);
      const iso = isoLocal(d);

      const head = createEl('div','day-head'); head.textContent = String(dayNum); cell.appendChild(head);
      const list = createEl('div','shift-list');

      const items = byDate.get(iso) || [];
      for (const s of items){
        const item = createEl('div','shift-item');
        item.innerHTML = `<span class="badge-me">Moja zmiana</span> <strong>${s.shift_code || ''}</strong>`;
        list.appendChild(item);
      }
      cell.appendChild(list);

      cell.addEventListener('click', async () => {
        const all = await fetchDayShifts(iso);
        openDayModal(iso, all);
      });
    } else {
      cell.classList.add('empty');
    }
    el.appendChild(cell);
  }
}

// ——— modal: osoby w dniu ———
function makePersonRow(s, forDateIso){
  const row = createEl('div','person-row');

  const left = createEl('div','name');
  left.textContent = s.full_name || '—';
  if (s.is_coordinator) left.classList.add('coordinator');
  if (s.is_zmiwaka) left.classList.add('zmiwaka');

  const right = createEl('div','code');
  right.textContent = s.shift_code || '';

  // jeśli to nie ja — pokaż „Zaproponuj zamianę”
  const me = (currentClaims && currentClaims()) || {};
  if (me.full_name && s.full_name && s.full_name !== me.full_name && s.user_id){
    const btn = createEl('button','swap-btn');
    btn.textContent = 'Zaproponuj zamianę';
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      openPickMyDateAndSendProposal({
        target_user_id: s.user_id,
        target_full_name: s.full_name,
        their_date: forDateIso
      });
    });
    right.appendChild(btn);
  }

  row.appendChild(left);
  row.appendChild(right);
  return row;
}

function makeCol(title, items, forDateIso){
  const col = createEl('div','col');
  const h = createEl('div','col-title');
  h.textContent = title;
  col.appendChild(h);

  const wrap = createEl('div','col-list');
  if (!items.length) {
    const empty = createEl('div','muted small');
    empty.textContent = '—';
    wrap.appendChild(empty);
  } else {
    for (const s of items) wrap.appendChild(makePersonRow(s, forDateIso));
  }
  col.appendChild(wrap);
  return col;
}

async function openDayModal(isoDate){
  const res = await fetch(`/api/day-shifts?date=${encodeURIComponent(isoDate)}`, {
    headers: { 'Authorization':'Bearer '+getToken() }
  });
  const data = await res.json();
  if (!res.ok){ alert((data && data.error) ? data.error : 'Błąd'); return; }

  const d = new Date(isoDate + 'T12:00:00');
  const title = new Intl.DateTimeFormat('pl-PL', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
    .format(d).replace(/^./, m=>m.toUpperCase());

  const modal = document.createElement('div'); modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <div class="modal-title">${title}</div>
        <button class="modal-close" aria-label="Zamknij">×</button>
      </div>
      <div class="modal-body two-cols">
        <div class="col"><div class="col-title">Popo (2 / 2/B)</div><div class="col-list" id="evening"></div></div>
        <div class="col"><div class="col-title">Rano (1 / 1/B)</div><div class="col-list" id="morning"></div></div>
      </div>
    </div>`;

  const fill = (id, arr) => {
    const wrap = modal.querySelector('#'+id);
    if (!arr?.length){ wrap.innerHTML = '<div class="muted small">—</div>'; return; }
    wrap.innerHTML = '';
    for (const s of arr) wrap.appendChild(makePersonRow(s, isoDate));
  };
  fill('evening', data.evening); fill('morning', data.morning);

  document.body.appendChild(modal);
  const close=()=>modal.remove();
  modal.addEventListener('click', e=>{ if (e.target===modal || e.target.classList.contains('modal-close')) close(); });
  document.addEventListener('keydown', function onEsc(e){ if (e.key==='Escape'){ close(); document.removeEventListener('keydown', onEsc); }});
}

(function initDashboard(){
  if (!document.body.classList.contains('page-dashboard')) return;

  const token = getToken();
  if (!token){ window.location.replace('/'); return; }

  initMenu();

  const prev = document.getElementById('prev-month');
  const next = document.getElementById('next-month');
  prev?.addEventListener('click', () => { CURRENT = new Date(CURRENT.getFullYear(), CURRENT.getMonth() - 1, 1); renderCalendar(); });
  next?.addEventListener('click', () => { CURRENT = new Date(CURRENT.getFullYear(), CURRENT.getMonth() + 1, 1); renderCalendar(); });

  document.getElementById('proposals-btn')?.addEventListener('click', () => { if (typeof openProposalsInbox === 'function') openProposalsInbox(); });
  document.getElementById('logout-btn')?.addEventListener('click', () => { clearToken(); window.location.href = '/'; });

  fetchShifts().then(() => renderCalendar()).catch(() => window.location.replace('/'));
})();

// ——— mini siatka wyboru mojej zmiany (do propozycji) ———
function buildMonthGrid(container, ymDate, myShiftMap, onPick){
  container.innerHTML = '';
  const y = ymDate.getFullYear(), m = ymDate.getMonth();
  const first = new Date(y,m,1), last = new Date(y,m+1,0);
  const startOffset = (first.getDay()+6)%7;
  const total = startOffset + last.getDate();
  const rows = Math.ceil(total/7);

  const head = createEl('div','month-head');
  const prev = createEl('button','btn-secondary'); prev.textContent='◀';
  const title = createEl('div','muted');
  const t = new Intl.DateTimeFormat('pl-PL',{month:'long',year:'numeric'}).format(first);
  title.textContent = t.charAt(0).toUpperCase() + t.slice(1);
  const next = createEl('button','btn-secondary'); next.textContent='▶';
  head.append(prev,title,next);
  container.appendChild(head);

  const grid = createEl('div','grid');
  for(let i=0;i<rows*7;i++){
    const cell = createEl('div','cell');
    const dnum = i - startOffset + 1;
    if (dnum>=1 && dnum<=last.getDate()){
      cell.textContent = dnum;
      const iso = isoLocal(new Date(y,m,dnum));
      if (myShiftMap.has(iso)){
        cell.classList.add('mine');
        cell.addEventListener('click', ()=> onPick(iso));
      } else {
        cell.classList.add('disabled');
      }
    } else { cell.classList.add('disabled'); }
    grid.appendChild(cell);
  }
  container.appendChild(grid);

  prev.addEventListener('click', ()=>{ const d=new Date(y,m,1); d.setMonth(m-1); buildMonthGrid(container,d,myShiftMap,onPick); });
  next.addEventListener('click', ()=>{ const d=new Date(y,m,1); d.setMonth(m+1); buildMonthGrid(container,d,myShiftMap,onPick); });
}

function openPickMyDateAndSendProposal({target_user_id, target_full_name, their_date}){
  const my = new Map();
  (ALL_SHIFTS || []).forEach(s => { my.set(s.shift_date, s); });

  const overlay = createEl('div','modal-backdrop pick-overlay');
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <div class="modal-title">Wybierz swoją zmianę do zamiany → ${target_full_name} (${their_date})</div>
        <button class="modal-close" aria-label="Zamknij">×</button>
      </div>
      <div class="modal-body">
        <div id="pick-grid"></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close=()=>overlay.remove();
  overlay.addEventListener('click', e=>{ if (e.target===overlay || e.target.classList.contains('modal-close')) close(); });

  const grid = overlay.querySelector('#pick-grid');
  buildMonthGrid(grid, new Date(their_date+'T12:00:00'), my, async (my_date)=>{
    try{
      await api('/api/proposals', { method:'POST', body: JSON.stringify({ target_user_id, my_date, their_date }) });
      close();
      openProposalsInbox(); // pokaż okno po wysyłce
    }catch(err){
      alert((err && err.error) ? err.error : 'Błąd wysyłki propozycji');
    }
  });
}

// ===== Propozycje zamian =====
async function fetchProposals(){ return await api('/api/proposals'); }

// tłumaczenie statusów
function statusBadge(status){
  const map = { pending:'oczekuje', accepted:'zaakceptowano', declined:'odrzucono', canceled:'anulowano' };
  const b = createEl('span', `status-badge status-${status}`); b.textContent = map[status] || status; return b;
}

// jeden wiersz propozycji – czytelnie: "Oddajesz → Dostajesz"
function renderProposalRow(p, type){
  const row = createEl('div','swap-row');

  const who = createEl('div','swap-who');
  if (type === 'in')  who.innerHTML = `${p.requester?.full_name || '—'} <span class="arrow">→</span> <span class="me">Ty</span>`;
  else                who.innerHTML = `<span class="me">Ty</span> <span class="arrow">→</span> ${p.target_user?.full_name || '—'}`;

  const oddajesz  = (type === 'out') ? p.my_date   : p.their_date;
  const dostajesz = (type === 'out') ? p.their_date: p.my_date;

  const dates = createEl('div','swap-dates');
  dates.innerHTML = `
    <span class="tag tag-small">Oddajesz</span>
    <span class="tag tag-date">${oddajesz}</span>
    <span class="arrow">⟶</span>
    <span class="tag tag-small">Dostajesz</span>
    <span class="tag tag-date">${dostajesz}</span>
  `;

  const actions = createEl('div','swap-actions');
  actions.appendChild(statusBadge(p.status));

  if (type === 'in' && p.status === 'pending'){
    const acc = createEl('button','swap-btn'); acc.textContent = 'Akceptuj';
    const dec = createEl('button','swap-btn'); dec.textContent = 'Odrzuć';
    acc.addEventListener('click', async ()=>{ try{ await api(`/api/proposals/${p.id}/accept`, {method:'POST'}); openProposalsInbox(true); }catch(err){ alert(err?.error || 'Błąd'); }});
    dec.addEventListener('click', async ()=>{ try{ await api(`/api/proposals/${p.id}/decline`, {method:'POST'}); openProposalsInbox(true); }catch(err){ alert(err?.error || 'Błąd'); }});
    actions.appendChild(acc); actions.appendChild(dec);
  }
  if (type === 'out' && p.status === 'pending'){
    const cancel = createEl('button','swap-btn'); cancel.textContent = 'Anuluj';
    cancel.addEventListener('click', async ()=>{ try{ await api(`/api/proposals/${p.id}/cancel`, {method:'POST'}); openProposalsInbox(true); }catch(err){ alert(err?.error || 'Błąd'); }});
    actions.appendChild(cancel);
  }

  row.appendChild(who); row.appendChild(dates); row.appendChild(actions);
  return row;
}

// okno z propozycjami
async function openProposalsInbox(noBackdropClose){
  let data; try{ data = await api('/api/proposals'); } catch(err){ alert(err?.error || 'Błąd pobierania propozycji'); return; }

  const overlay = createEl('div','modal-backdrop');
  overlay.innerHTML = `
    <div class="modal" style="max-width:980px;">
      <div class="modal-head">
        <div class="modal-title">Propozycje</div>
        <button class="modal-close" aria-label="Zamknij">×</button>
      </div>
      <div class="modal-body">
        <div class="muted" style="margin-bottom:10px;">
          <strong>Legenda:</strong> <span class="tag tag-small">Oddajesz</span> → <span class="tag tag-small">Dostajesz</span>
        </div>
        <div class="two-cols">
          <div class="col"><div class="col-title">Odebrane</div><div class="col-list" id="inbox"></div></div>
          <div class="col"><div class="col-title">Wysłane</div><div class="col-list" id="outbox"></div></div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close=()=>overlay.remove();
  const closeBtn = overlay.querySelector('.modal-close');
  if (!noBackdropClose){ overlay.addEventListener('click', e=>{ if (e.target===overlay || e.target===closeBtn) close(); }); }
  else closeBtn.addEventListener('click', close);

  const inbox = overlay.querySelector('#inbox');
  const outbox = overlay.querySelector('#outbox');

  const incoming = data.incoming || [];
  const outgoing = data.outgoing || [];

  inbox.innerHTML  = incoming.length ? '' : '<div class="muted">Brak propozycji</div>';
  outbox.innerHTML = outgoing.length ? '' : '<div class="muted">Brak propozycji</div>';

  incoming.forEach(p => inbox.appendChild(renderProposalRow(p,'in')));
  outgoing.forEach(p => outbox.appendChild(renderProposalRow(p,'out')));
}

// ----- Toasty -----
const toast = (() => {
  let stack = document.querySelector('.toast-stack');
  if (!stack){ stack = document.createElement('div'); stack.className = 'toast-stack'; document.body.appendChild(stack); }
  function show(msg, kind='info', ms=2800){
    const t = document.createElement('div'); t.className = `toast ${kind}`; t.textContent = msg;
    stack.appendChild(t);
    setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateY(-4px)'; }, ms-400);
    setTimeout(()=> t.remove(), ms);
  }
  return {
    info:(m,ms)=>show(m,'info',ms),
    ok:(m,ms)=>show(m,'success',ms),
    error:(m,ms)=>show(m,'error',ms),
    success:(m,ms)=>show(m,'success',ms),
  };
})();

// кнопка «Propozycje» если где-то есть
document.getElementById('menu-proposals')?.addEventListener('click', ()=> {
  window.location.href = '/proposals';
});

// ----- PWA registration -----
if ('serviceWorker' in navigator){
  navigator.serviceWorker.register('/static/sw.js').catch(()=>{ /* ignore */ });
}
window.addEventListener('online',  ()=> toast.info('Połączono z siecią'));
window.addEventListener('offline', ()=> toast.error('Jesteś offline'));
