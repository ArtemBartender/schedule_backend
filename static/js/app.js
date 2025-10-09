// static/js/app.js
(function () {
  'use strict';

  // ====== utils ======
  function $(sel){ return document.querySelector(sel); }
  function createEl(tag, cls){ const el = document.createElement(tag); if (cls) el.className = cls; return el; }

  const TOKEN_KEY = 'access_token';
  function getToken(){
    try{
      // читаем и из localStorage, и из sessionStorage
      return (
        localStorage.getItem(TOKEN_KEY) ||
        sessionStorage.getItem(TOKEN_KEY) ||
        ''
      );
    }catch(_){ return ''; }
  }
  function setToken(t){
    try{
      localStorage.setItem(TOKEN_KEY, t||'');
    }catch(_){}
  }
  function clearToken(){
    try{
      localStorage.removeItem(TOKEN_KEY);
    }catch(_){}
    try{
      sessionStorage.removeItem(TOKEN_KEY);
    }catch(_){}
  }

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

  // ====== API with retry + keep-alive ======
  async function api(path, opts={}) {
    const headers = Object.assign({}, opts.headers || {});
    const t = getToken(); if (t && !headers.Authorization) headers.Authorization = 'Bearer ' + t;
    if (!('Content-Type' in headers) && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';

    const run = async () => {
      const res = await fetch(path, { ...opts, headers, cache:'no-store' });
      const ct = res.headers.get('content-type') || '';
      const body = ct.includes('application/json') ? await res.json().catch(()=>({})) : await res.text().catch(()=> '');
      if (!res.ok){
        if (res.status === 401) {
          // выкидываем юзера на логин, сохраняя куда он хотел
          try { clearToken(); } catch(_){}
          const redirect = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.href = '/?redirect=' + redirect;
          return; // break
        }
        const err = new Error(body?.error || `Błąd ${res.status}`);
        err.status = res.status; throw err;
      }

      return body;
    };

    try { return await run(); }
    catch(e){
      if (e.status === 500 || e.status === 503){ // Render/DB just woke up
        await new Promise(r=>setTimeout(r, 800));
        return await run();
      }
      throw e;
    }
  }

  // отдать наружу то, что нужно другим скриптам
  window.api = api;
  window.getToken = getToken;
  window.setToken = setToken;
  window.clearToken = clearToken;
  window.currentClaims = currentClaims;

  // keep-alive
  (function keepAlive(){
    const ping = () => fetch('/api/health', { cache:'no-store' }).catch(()=>{});
    let timer = null;
    function start(){
      clearInterval(timer);
      ping();
      timer = setInterval(() => {
        if (document.visibilityState === 'visible' && navigator.onLine) ping();
      }, 4*60*1000);
    }
    window.addEventListener('visibilitychange', ()=>{ if (document.visibilityState==='visible') start(); });
    window.addEventListener('focus', start);
    start();
  })();

  // =============== AUTH (login/register) ===============
  (function initAuth(){
    if (!document.body.classList.contains('page-auth')) return;

    const $ = s => document.querySelector(s);
    const msgLogin = $('#login-msg');
    const msgReg   = $('#register-msg');

    // API helper (использует тот же токен и обработку, что и остальная часть app.js)
    async function apiAuth(path, body){
      const res = await fetch(path, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(body||{})
      });
      const data = await res.json().catch(()=> ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP '+res.status));
      return data;
    }

    // переключения Login <-> Register
    $('#to-register')?.addEventListener('click', (e)=>{ e.preventDefault(); $('#login-view').classList.add('hidden'); $('#register-view').classList.remove('hidden'); });
    $('#to-login')?.addEventListener('click', (e)=>{ e.preventDefault(); $('#register-view').classList.add('hidden'); $('#login-view').classList.remove('hidden'); });

    // показать/скрыть пароль
    document.querySelectorAll('.toggle-pass').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const input = btn.previousElementSibling;
        input.type = (input.type === 'password') ? 'text' : 'password';
        btn.textContent = (input.type === 'password') ? '👁' : '🙈';
      });
    });

    // CapsLock hint (login)
    $('#login-pass')?.addEventListener('keydown', e=>{
      const caps = $('#login-caps'); if (!caps) return;
      caps.hidden = !(e.getModifierState && e.getModifierState('CapsLock'));
    });
    $('#login-pass')?.addEventListener('keyup', e=>{
      const caps = $('#login-caps'); if (!caps) return;
      caps.hidden = !(e.getModifierState && e.getModifierState('CapsLock'));
    });

    // Индикатор силы пароля (register)
    const regPass = $('#reg-pass');
    function strengthScore(p){
      if (!p) return 0;
      let s = 0;
      if (p.length >= 8) s++;
      if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++
      if (/\d/.test(p)) s++;
      if (/[^A-Za-z0-9]/.test(p)) s++;
      if (p.length >= 12) s++; // бонус за длину
      return Math.min(s,5);
    }
    regPass?.addEventListener('input', ()=>{
      const bar = document.getElementById('pwd-bar');
      const hint= document.getElementById('pwd-hint');
      const sc  = strengthScore(regPass.value);
      const w   = [0,20,40,60,80,100][sc];
      if (bar){ bar.style.width = w+'%'; }
      if (hint){ hint.textContent = ['Bardzo słabe','Słabe','OK','Dobre','Bardzo dobre','Świetne'][sc] || ' '; }
    });

    // ЛОГИН
    $('#login-form')?.addEventListener('submit', async (e)=>{
      e.preventDefault();
      msgLogin.textContent = ''; msgLogin.className='form-msg';
      const fd = new FormData(e.currentTarget);
      const email = String(fd.get('email')||'').trim();
      const password = String(fd.get('password')||'');
      if (!email || !password){ msgLogin.textContent = 'Podaj email i hasło.'; msgLogin.classList.add('error'); return; }

      try{
        const data = await apiAuth('/api/login', { email, password });
        const token = data && (data.access_token || data.token);
        if (!token) throw new Error('Brak tokenu');

        // «Запомнить меня»: по чекбоксу пишем в localStorage, иначе в sessionStorage
        const remember = $('#remember-me')?.checked;
        if (remember) {
          localStorage.setItem('access_token', token);
          sessionStorage.removeItem('access_token');
        } else {
          sessionStorage.setItem('access_token', token);
          localStorage.removeItem('access_token');
        }

        msgLogin.textContent = 'Zalogowano.'; msgLogin.classList.add('ok');
        window.location.href = '/start';
      }catch(err){
        msgLogin.textContent = err.message || 'Błąd logowania';
        msgLogin.classList.add('error');
      }
    });

    // РЕГИСТРАЦИЯ
    $('#register-form')?.addEventListener('submit', async (e)=>{
      e.preventDefault();
      msgReg.textContent=''; msgReg.className='form-msg';
      const fd = new FormData(e.currentTarget);
      const full_name = String(fd.get('full_name')||'').trim();
      const email     = String(fd.get('email')||'').trim();
      const password  = String(fd.get('password')||'');

      if (!full_name || !email || !password){
        msgReg.textContent = 'Wypełnij wszystkie pola.'; msgReg.classList.add('error'); return;
      }
      if (strengthScore(password) < 3){
        msgReg.textContent = 'Hasło jest zbyt słabe.'; msgReg.classList.add('error'); return;
      }

      try{
        await apiAuth('/api/register', { full_name, email, password });
        msgReg.textContent = 'Konto utworzone. Zaloguj się.'; msgReg.classList.add('ok');
        setTimeout(()=> { document.getElementById('to-login').click(); }, 700);
      }catch(err){
        msgReg.textContent = err.message || 'Błąd rejestracji';
        msgReg.classList.add('error');
      }
    });

    // «Забыли пароль?» — заглушка
    $('#forgot-link')?.addEventListener('click', (e)=>{
      e.preventDefault();
      alert('Reset hasła będzie dostępny wkrótce. Skontaktuj się z koordynatorem.');
    });
  })();

  // ====== MENU ======
  function initMenu(){
    const toggle = document.getElementById('menu-toggle');
    const panel  = document.getElementById('menu-panel');
    if (!toggle || !panel) return;
    if (panel.dataset.bound === '1') return;
    panel.dataset.bound = '1';


    // Внутри initMenu()
    const coordLink = document.getElementById('menu-coord-panel');
    if (coordLink) {
      const claims = (typeof currentClaims === 'function') ? currentClaims() : {};
      const isCoord = (claims.role || '').toLowerCase() === 'coordinator';
      coordLink.hidden = !isCoord;
    }

    const claims = (typeof currentClaims === 'function') ? currentClaims() : {};
    const adminLink = document.getElementById('menu-admin');
    if (adminLink) {
      const isAdmin = String(claims.role || '').toLowerCase() === 'admin';
      if (!isAdmin) {
        // полностью убираем пункт из DOM, чтобы по нему нельзя было кликнуть
        adminLink.remove();
      } else {
        adminLink.hidden = false;
      }
    }

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

    document.getElementById('menu-logout')?.addEventListener('click', ()=>{ clearToken(); window.location.href = '/'; });
    document.getElementById('menu-proposals')?.addEventListener('click', ()=>{ window.location.href = '/proposals'; close(); });
  }
  window.initMenu = initMenu;
  initMenu();

  // ====== Dashboard (calendar only) ======
  let ALL_SHIFTS = [];
  let CURRENT = new Date();

  async function fetchShifts(){
    const data = await api('/api/my-shifts', { method:'GET' });
    ALL_SHIFTS = data || [];
    return data;
  }
  async function fetchDayShifts(isoDate){
    return await api('/api/day-shifts?date=' + encodeURIComponent(isoDate), { method:'GET' });
  }

  function groupShiftsByDate(shifts){
    const m = new Map();
    for (const s of (shifts||[])){
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
    const mt = $('#month-title'); if (mt) mt.textContent = monthTitle.charAt(0).toUpperCase() + monthTitle.slice(1);

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
    if (s.is_zmiwaka) left.classList.add('zmywak');

    const right = createEl('div','code');
    right.textContent = s.shift_code || '';

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
    if (!items?.length) {
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
    let data;
    try{
      data = await api('/api/day-shifts?date=' + encodeURIComponent(isoDate));
    }catch(err){ alert(err.message || 'Błąd'); return; }

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

    document.getElementById('proposals-btn')?.addEventListener('click', () => { window.location.href = '/proposals'; });
    document.getElementById('logout-btn')?.addEventListener('click', () => { clearToken(); window.location.href = '/'; });

    fetchShifts().then(renderCalendar).catch(()=> window.location.replace('/'));
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
        window.location.href = '/proposals';
      }catch(err){
        alert(err?.message || 'Błąd wysyłki propozycji');
      }
    });
  }

  // ===== Propozycje zamian =====
  async function fetchProposals(){ return await api('/api/proposals'); }

  function statusBadge(status){
    const map = { pending:'W oczekiwaniu', accepted:'Zaakceptowano', declined:'Odrzucono', canceled:'Anulowano', approved:'Zatwierdzono', rejected:'Odrzucono' };
    const b = createEl('span', `status-badge status-${status}`); b.textContent = map[status] || status; return b;
  }

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
      acc.addEventListener('click', async ()=>{ try{ await api(`/api/proposals/${p.id}/accept`, {method:'POST'}); openProposalsInbox(true); }catch(err){ alert(err?.message || 'Błąd'); }});
      dec.addEventListener('click', async ()=>{ try{ await api(`/api/proposals/${p.id}/decline`, {method:'POST'}); openProposalsInbox(true); }catch(err){ alert(err?.message || 'Błąd'); }});
      actions.appendChild(acc); actions.appendChild(dec);
    }
    if (type === 'out' && p.status === 'pending'){
      const cancel = createEl('button','swap-btn'); cancel.textContent = 'Anuluj';
      cancel.addEventListener('click', async ()=>{ try{ await api(`/api/proposals/${p.id}/cancel`, {method:'POST'}); openProposalsInbox(true); }catch(err){ alert(err?.message || 'Błąd'); }});
      actions.appendChild(cancel);
    }

    row.appendChild(who); row.appendChild(dates); row.appendChild(actions);
    return row;
  }

  async function openProposalsInbox(noBackdropClose){
    let data; try{ data = await fetchProposals(); } catch(err){ alert(err?.message || 'Błąd pobierania propozycji'); return; }

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

  // ===== Toasts =====
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

  // nav кнопка
  document.getElementById('menu-proposals')?.addEventListener('click', ()=> {
    window.location.href = '/proposals';
  });

  // PWA
  if ('serviceWorker' in navigator){
    navigator.serviceWorker.register('/static/sw.js').catch(()=>{ /* ignore */ });
  }
  window.addEventListener('online',  ()=> toast.info('Połączono z siecią'));
  window.addEventListener('offline', ()=> toast.error('Jesteś offline'));

})();

// фиксируем CSS-переменную под реальную высоту шапки
(function setTopbarHeightVar(){
  const tb = document.querySelector('.topbar');
  if (!tb) return;
  const apply = () =>
    document.documentElement.style.setProperty('--topbar-h', tb.offsetHeight + 'px');
  apply();
  window.addEventListener('resize', apply);
})();


// ---- Time helpers (Europe/Warsaw) ----
// (без export; пробрасываем в window ниже)
function warsawToday() {
  const s = new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
  // s типа "25.08.2025, 16:03:21"
  const [d, m, y] = s.split(',')[0].split('.').map(x => parseInt(x, 10));
  return new Date(Date.UTC(y, m - 1, d)); // UTC-день
}
function warsawTomorrow() {
  const t = warsawToday();
  t.setUTCDate(t.getUTCDate() + 1);
  return t;
}
function isoToUTCDate(iso /* 'YYYY-MM-DD' */) {
  const [Y, M, D] = String(iso || '').split('-').map(Number);
  return new Date(Date.UTC(Y, M - 1, D));
}
function isBeforeTomorrowWarsaw(iso) {
  // true если iso < завтра по Варшаве
  return isoToUTCDate(iso) < warsawTomorrow();
}
// отдаём глобально для других скриптов
window.warsawToday = warsawToday;
window.warsawTomorrow = warsawTomorrow;
window.isoToUTCDate = isoToUTCDate;
window.isBeforeTomorrowWarsaw = isBeforeTomorrowWarsaw;


(function startKeepAlive(){
  const ping = () => fetch('/api/health', { cache: 'no-store' }).catch(()=>{});
  ping(); // сразу при загрузке
  setInterval(ping, 240000); // каждые ~4 минуты
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ping();
  });
})();

