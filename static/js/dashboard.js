// static/js/dashboard.js
(function initDashboardList() {
  'use strict';
  if (!document.body.classList.contains('page-dashboard')) return;

  // меню
  if (typeof window.initMenu === 'function') { try { window.initMenu(); } catch (_) {} }

  // ---------- utils ----------
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

  const api = (url, opts) => (typeof window.api === 'function'
    ? window.api(url, opts || {})
    : fetch(url, Object.assign({headers:{'Content-Type':'application/json'}}, opts||{})).then(async r=>{
        const ct=r.headers.get('content-type')||''; const b=ct.includes('json')?await r.json().catch(()=>({})):await r.text();
        if(!r.ok){ const e=new Error(b?.error||('HTTP '+r.status)); e.status=r.status; throw e; } return b;
      }));

  // ---- Time helpers (Europe/Warsaw) ----
  function warsawTodayUTC(){
    const s = new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
    const left = s.split(',')[0].trim();
    const parts = left.split('.');
    const d = parseInt(parts[0],10), m = parseInt(parts[1],10), y = parseInt(parts[2],10);
    return new Date(Date.UTC(y, m-1, d));
  }
  function warsawTomorrowUTC(){ const t = warsawTodayUTC(); t.setUTCDate(t.getUTCDate() + 1); return t; }
  function isoToUTCDate(iso){ const [Y,M,D] = String(iso||'').split('-').map(Number); return new Date(Date.UTC(Y, M-1, D)); }
  function isBeforeTomorrowWarsawISO(iso){ return isoToUTCDate(iso) < warsawTomorrowUTC(); }

  const WD     = new Intl.DateTimeFormat('pl-PL', { weekday: 'short' });
  const DD     = new Intl.DateTimeFormat('pl-PL', { day: '2-digit' });
  const MM     = new Intl.DateTimeFormat('pl-PL', { month: '2-digit' });
  const MTITLE = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' });
  const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const codeGroup = code => String(code||'').trim().startsWith('2') ? '2' : '1';

  // ---------- state ----------
  const daysRoot   = $('#days-list');
  const monthTitle = $('#month-title');

  const TODAY = new Date(); TODAY.setHours(12,0,0,0);
  let baseMonth = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
  let showPast  = false;

  // мои смены
  let MY_MAP = new Map();
  async function loadMyShifts(){
    try { const arr = await api('/api/my-shifts', { method:'GET' }); MY_MAP = new Map((arr||[]).map(s => [s.shift_date, s])); }
    catch { MY_MAP = new Map(); }
  }
  const iWorkThatDay = iso => MY_MAP.has(iso);

  // ========= Chips =========
  function styleAccent(el, kind){
    // kind: 'mazurek' | 'polonez' | 'zmywak' | ''
    if (!kind) return;
    if (kind === 'mazurek') {
      el.style.boxShadow = 'inset 0 0 0 2px rgba(42,110,245,.45)';   // синий
    } else if (kind === 'polonez') {
      el.style.boxShadow = 'inset 0 0 0 2px rgba(255,214,74,.55)';   // жёлтый
    } else if (kind === 'zmywak') {
      el.style.boxShadow = 'inset 0 0 0 2px rgba(150,160,170,.65)';  // серый
    }
  }
  function badge(text, cls){
    const b = document.createElement('span');
    b.className = `badge ${cls||''}`;
    b.textContent = text;
    return b;
  }

  
  function chip(person, isoDate) {
    const el = document.createElement('span');
    el.className = 'person-chip';
    el.title = person?.full_name || '';
  
    // --- бейджи/признаки
    // bar?
    const looksBar = /(^|[\/\s])B($|[\/\s])/i.test(String(person?.shift_code || ''));
    const isBar = person?.is_bar_today ?? looksBar;
  
    // змывак?
    const isZ = !!person?.is_zmiwaka;
  
    // координатор на ЭТУ смену?
    const coordLounge = (person?.coord_lounge || '').toLowerCase();
  
    // lounge от цифры (если когда-либо начнём его отдавать)
    const lounge = (person?.lounge || '').toLowerCase();
  
    // --- рамка-приоритеты:
    // 1) змывак -> серый
    // 2) бармен -> жёлтый (полонез)
    // 3) иначе: по lounge (если есть)
    let frame = '';
    if (isZ) frame = 'zmywak';
    else if (isBar) frame = 'polonez';
    else if (lounge === 'mazurek' || lounge === 'polonez') frame = lounge;
    styleAccent(el, frame);
  
    // имя
    const nm = document.createElement('span');
    nm.className = 'name';
    nm.textContent = person?.full_name || '';
    el.appendChild(nm);
  
    // бейджи
    if (isBar) el.appendChild(badge('bar','badge-bar'));
  
    if (person?.coord_lounge){
      const k = badge('koord.','badge-coord');
      if (coordLounge === 'mazurek') k.classList.add('lounge-mazurek');
      else if (coordLounge === 'polonez') k.classList.add('lounge-polonez');
      el.appendChild(k);
    }
  
    if (isZ){
      el.appendChild(badge('zmywak','badge-zmiwak'));
    }
  
    // код (1/2, скрываем /B в бейдже)
    const codeText = String(person?.shift_code || '').replace(/\s+/g,'').replace('/B','').replace('B','');
    if (codeText){
      const c = document.createElement('span');
      c.className = 'badge badge-shift';
      c.textContent = codeText;
      el.appendChild(c);
    }
  
    // клик — панель действий
    el.addEventListener('click', (e) => { e.stopPropagation(); showActionsUnderDay(isoDate, person); });
    return el;
  }

  // ========= Колонки =========
  function colBlock(label, people, isoDate, group) {
    const wrap = document.createElement('div');
    wrap.className = `day-col shift-group group--${group}`;

    const head = document.createElement('div');
    head.className = 'group-head';
    head.innerHTML = `
      <span class="group-title">${esc(label)}</span>
      <span class="group-count">${people.length}</span>
    `;
    wrap.appendChild(head);

    if (!people.length) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = '—';
      wrap.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'sg-list';
      people.forEach(p => list.appendChild(chip(p, isoDate)));
      wrap.appendChild(list);
    }
    return wrap;
  }

  // ========= День =========
  function dayRow(iso, data, isToday) {
    const d = new Date(iso + 'T12:00:00');
    const row = document.createElement('div');
    row.className = 'day-row card';
    row.style.padding = '12px';
    row.dataset.dayRow = iso;
    if (isToday) row.id = 'today-anchor';

    const left = document.createElement('div');
    left.style.minWidth = '64px';
    left.style.textAlign = 'left';
    left.innerHTML = `
      <div class="muted" style="font-weight:700">${esc(WD.format(d))}</div>
      <div style="font-size:1.05rem">${DD.format(d)}.${MM.format(d)}</div>`;

    const right = document.createElement('div');
    right.style.display = 'grid';
    right.style.gridTemplateColumns = '1fr';
    right.style.gap = '10px';

    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = '1fr';
    grid.style.gap = '8px';
    grid.appendChild(colBlock('Rano', data.morning || [], iso, 'morning'));
    grid.appendChild(colBlock('Popo', data.evening || [], iso, 'evening'));

    right.appendChild(grid);

    const flex = document.createElement('div');
    flex.style.display = 'grid';
    flex.style.gridTemplateColumns = '80px 1fr';
    flex.style.gap = '14px';
    flex.appendChild(left);
    flex.appendChild(right);

    row.appendChild(flex);

    // слот для действий
    const actionsSlot = document.createElement('div');
    actionsSlot.className = 'day-actions-slot';
    actionsSlot.style.cssText = 'margin-top:8px; display:block; width:100%;';
    row.appendChild(actionsSlot);

    return row;
  }

  // ========= Панель действий =========
  function showActionsUnderDay(iso, person){
    $$('.day-actions').forEach(a => a.remove());

    const row = document.querySelector(`[data-day-row="${iso}"]`);
    if (!row) return;

    let slot = row.querySelector('.day-actions-slot');
    if (!slot){
      slot = document.createElement('div');
      slot.className = 'day-actions-slot';
      slot.style.cssText = 'margin-top:8px; display:block; width:100%;';
      row.appendChild(slot);
    }

    const wrap = document.createElement('div');
    wrap.className = 'day-actions';
    wrap.style.cssText = [
      'display:flex','gap:8px','flex-wrap:wrap','align-items:center',
      'padding:10px','border:1px dashed var(--border)','border-radius:10px',
      'margin-top:6px','width:100%','box-sizing:border-box'
    ].join(';');

    wrap.innerHTML = `<div class="muted">Dla: <b>${esc(person.full_name)}</b> (${esc(person.shift_code||'—')})</div>`;

    const spacer  = document.createElement('span'); spacer.style.flex = '1';
    const btnSwap = document.createElement('button'); btnSwap.className = 'btn-secondary'; btnSwap.textContent = 'Zaproponuj wymianę';
    const btnTake = document.createElement('button'); btnTake.className = 'btn-secondary'; btnTake.textContent = 'Weź tę zmianę';

    btnSwap.addEventListener('click', ()=> openPickMyDateModal({ isoTheir: iso, person }));

    btnTake.addEventListener('click', async ()=> {
      if (isBeforeTomorrowWarsawISO(iso)){ alert('Tej zmiany nie można wziąć (przeszłość / dzisiaj).'); return; }
      if (iWorkThatDay(iso)){ alert('W tym dniu już masz zmianę.'); return; }
      try{
        await api('/api/takeovers', { method:'POST', body: JSON.stringify({ target_user_id: person.user_id, date: iso }) });
        alert('Prośba wysłana do właściciela zmiany.');
      }catch(err){ alert(err.message || 'Błąd'); }
    });

    wrap.appendChild(spacer);
    wrap.appendChild(btnSwap);
    wrap.appendChild(btnTake);

    slot.innerHTML = '';
    slot.appendChild(wrap);
    wrap.scrollIntoView({behavior:'smooth', block:'nearest'});
  }

  // ========= Модал выбора моей смены =========
  function openPickMyDateModal({ isoTheir, person }){
    const tomo = warsawTomorrowUTC();
    const myList = Array
      .from(MY_MAP.values())
      .filter(s => isoToUTCDate(s.shift_date) >= tomo)
      .sort((a,b)=> a.shift_date.localeCompare(b.shift_date));

    const allow = (my) => {
      if (my.shift_date === isoTheir){
        const gMy = codeGroup(my.shift_code), gTheir = codeGroup(person.shift_code);
        return gMy !== gTheir;
      }
      return true;
    };

    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.innerHTML = `
      <div class="modal" style="max-width:900px;">
        <div class="modal-head">
          <div class="modal-title">Wybierz swoją zmianę do zamiany → ${esc(person.full_name)} (${isoTheir})</div>
          <button class="modal-close" aria-label="Zamknij">×</button>
        </div>
        <div class="modal-body">
          <div id="my-ladder"></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close=()=>overlay.remove();
    overlay.addEventListener('click', e=>{ if (e.target===overlay || e.target.classList.contains('modal-close')) close(); });

    const cont = overlay.querySelector('#my-ladder');
    if (!myList.length){
      cont.innerHTML = '<div class="muted">Brak Twoich zmian od jutra. Nie można proponować wymiany na dziś/wczoraj.</div>';
      return;
    }

    cont.innerHTML = myList.map(s=>{
      const ok = allow(s);
      return `
        <div class="person-row" style="align-items:center;">
          <div class="name"><div><b>${s.shift_date}</b> — ${esc(s.shift_code||'')}</div></div>
          <div class="code">
            <button class="swap-btn" data-date="${s.shift_date}" ${ok?'':'disabled'}>${ok?'Wybierz':'Niedostępna'}</button>
          </div>
        </div>`;
    }).join('');

    cont.querySelectorAll('button[data-date]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const my_date = btn.getAttribute('data-date');
        try{
          await api('/api/proposals', { method:'POST',
            body: JSON.stringify({ target_user_id: person.user_id, my_date, their_date: isoTheir }) });
          close(); alert('Propozycja wysłana.'); window.location.href = '/proposals';
        }catch(err){ alert(err.message || 'Błąd'); }
      });
    });
  }

  // ========= Bulk загрузка/рендер месяца =========
  function monthKey(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'); }
  async function fetchMonthBulk(d){
    const y = d.getFullYear(), m = d.getMonth()+1;
    const key = 'monthCache:'+y+'-'+String(m).padStart(2,'0');
    try{
      const cached = sessionStorage.getItem(key);
      if (cached){
        const { ts, data } = JSON.parse(cached);
        if (Date.now() - ts < 120*1000) return data;
      }
    }catch(_){}
    const data = await api(`/api/month-shifts?year=${y}&month=${m}`, { method:'GET' });
    try{ sessionStorage.setItem(key, JSON.stringify({ ts:Date.now(), data })); }catch(_){}
    return data;
  }

  function updatePastBtn() {
    const btn = $('#toggle-past');
    if (!btn) return;
    btn.textContent = showPast ? 'Ukryj przeszłe' : 'Pokaż przeszłe zmiany';
    btn.setAttribute('aria-pressed', String(showPast));
  }

  async function renderMonthLadder() {
    daysRoot.innerHTML = '';

    const monthStart = new Date(baseMonth.getFullYear(), baseMonth.getMonth(), 1, 12, 0, 0, 0);
    const monthEnd   = new Date(baseMonth.getFullYear(), baseMonth.getMonth() + 1, 0, 12, 0, 0, 0);

    const title = MTITLE.format(monthStart);
    if (monthTitle) monthTitle.textContent = title.charAt(0).toUpperCase() + title.slice(1);

    let startDate = showPast ? new Date(monthStart) : new Date(Math.max(monthStart.getTime(), TODAY.getTime()));
    if (startDate > monthEnd) { showPast = true; updatePastBtn(); startDate = new Date(monthStart); }

    const isoList = [];
    for (let d = new Date(startDate); d <= monthEnd; d.setDate(d.getDate() + 1)) isoList.push(isoLocal(d));
    if (!isoList.length){
      const stub = document.createElement('div'); stub.className='muted'; stub.style.padding='12px'; stub.textContent='Brak dni do wyświetlenia w tym miesiącu.'; daysRoot.appendChild(stub); return;
    }

    const frag = document.createDocumentFragment();
    isoList.forEach(iso => {
      const row = dayRow(iso, { morning:[], evening:[] }, iso === isoLocal(TODAY));
      const holder = document.createElement('div'); holder.className = 'muted'; holder.textContent = 'Ładowanie…';
      row.appendChild(holder); frag.appendChild(row);
    });
    daysRoot.appendChild(frag);

    const monthData = await fetchMonthBulk(baseMonth);

    let i = 0;
    function step(){
      const t0 = performance.now();
      while (i < isoList.length && performance.now() - t0 < 16) {
        const iso = isoList[i++];
        const data = monthData[iso] || { morning:[], evening:[] };
        const oldRow = daysRoot.querySelector(`[data-day-row="${iso}"]`);
        if (oldRow) {
          const newRow = dayRow(iso, data, iso === isoLocal(TODAY));
          oldRow.replaceWith(newRow);
        }
      }
      if (i < isoList.length) requestAnimationFrame(step);
      else {
        const anchor = document.getElementById('today-anchor');
        if (anchor) setTimeout(()=> anchor.scrollIntoView({ behavior:'smooth', block:'start' }), 40);
      }
    }
    requestAnimationFrame(step);
  }

  // ---------- controls ----------
  $('#prev-month')?.addEventListener('click', () => { baseMonth = new Date(baseMonth.getFullYear(), baseMonth.getMonth() - 1, 1); renderMonthLadder(); });
  $('#next-month')?.addEventListener('click', () => { baseMonth = new Date(baseMonth.getFullYear(), baseMonth.getMonth() + 1, 1); renderMonthLadder(); });
  $('#jump-today')?.addEventListener('click', () => { baseMonth = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1); renderMonthLadder(); });
  $('#toggle-past')?.addEventListener('click', () => { showPast = !showPast; updatePastBtn(); renderMonthLadder(); });

  // ---------- start ----------
  (async () => {
    await loadMyShifts();
    updatePastBtn();
    renderMonthLadder();
  })();

})();

