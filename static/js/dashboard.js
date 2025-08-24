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

  const WD     = new Intl.DateTimeFormat('pl-PL', { weekday: 'short' });
  const DD     = new Intl.DateTimeFormat('pl-PL', { day: '2-digit' });
  const MM     = new Intl.DateTimeFormat('pl-PL', { month: '2-digit' });
  const MTITLE = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' });

  const isoLocal = d => {
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  };
  const codeGroup = code => String(code||'').trim().startsWith('2') ? '2' : '1';

  // ---------- state ----------
  const daysRoot   = $('#days-list');
  const monthTitle = $('#month-title');

  const TODAY = new Date(); TODAY.setHours(12,0,0,0);
  let baseMonth = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
  let showPast  = false;

  // мои смены для проверок
  let MY_MAP = new Map();
  async function loadMyShifts(){
    try { const arr = await api('/api/my-shifts', { method:'GET' });
      MY_MAP = new Map((arr||[]).map(s => [s.shift_date, s]));
    } catch{ MY_MAP = new Map(); }
  }
  const iWorkThatDay = iso => MY_MAP.has(iso);

  // ---------- UI helpers ----------
  function chip(person, isoDate) {
    const el = document.createElement('span');
    el.className = 'chip';
    el.title = person.full_name || '';
    el.innerHTML = `
      <span class="chip-name">${esc(person.full_name || '—')}</span>
      <span class="chip-right">
        ${person.is_coordinator ? '<span class="badge badge-coord">koord.</span>' : ''}
        ${person.is_zmiwaka ? '<span class="badge badge-zmiwaka">zmyw.</span>' : ''}
        ${person.shift_code ? `<span class="code">${esc(person.shift_code)}</span>` : ''}
      </span>`;
    // по клику показываем панель действий внизу дня
    el.addEventListener('click', (e) => { e.stopPropagation(); showActionsUnderDay(isoDate, person); });
    return el;
  }

  function colBlock(label, people, isoDate) {
    const wrap = document.createElement('div');
    wrap.className = 'day-col';

    const head = document.createElement('div');
    head.className = 'muted small';
    head.textContent = `${label} • ${people.length}`;
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
    grid.appendChild(colBlock('Rano',   data.morning || [], iso));
    grid.appendChild(colBlock('Popo',   data.evening || [], iso));
    right.appendChild(grid);

    const flex = document.createElement('div');
    flex.style.display = 'grid';
    flex.style.gridTemplateColumns = '80px 1fr';
    flex.style.gap = '14px';
    flex.appendChild(left);
    flex.appendChild(right);

    row.appendChild(flex);

    // слот для действий — ВСЕГДА внизу карточки дня
    const actionsSlot = document.createElement('div');
    actionsSlot.className = 'day-actions-slot';
    actionsSlot.style.cssText = 'margin-top:8px; display:block; width:100%;';
    row.appendChild(actionsSlot);

    return row;
  }

  // панель действий внизу
  function showActionsUnderDay(iso, person){
    $$('.day-actions').forEach(a => a.remove()); // только одна панель

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

  // выбор моей смены для замены (строчный «календарь»)
  function openPickMyDateModal({ isoTheir, person }){
    const myList = Array.from(MY_MAP.values()).sort((a,b)=> a.shift_date.localeCompare(b.shift_date));

    const allow = (my) => {
      // в этот же день — можно, только если группы разные (1↔2)
      if (my.shift_date === isoTheir){
        const gMy = codeGroup(my.shift_code), gTheir = codeGroup(person.shift_code);
        return gMy !== gTheir;
      }
      // в другой день — всегда ок
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
      cont.innerHTML = '<div class="muted">Brak Twoich zmian do zaproponowania.</div>';
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

  // ---------- data ----------
  async function fetchDay(iso) {
    try { return await api('/api/day-shifts?date=' + encodeURIComponent(iso)); }
    catch (e) { return { morning: [], evening: [], _error: e?.message || 'Błąd' }; }
  }

  // подпись для кнопки "Pokaż/Ukryj przeszłe"
  function updatePastBtn() {
    const btn = $('#toggle-past');
    if (!btn) return;
    btn.textContent = showPast ? 'Ukryj przeszłe' : 'Pokaż przeszłe zmiany';
    btn.setAttribute('aria-pressed', String(showPast));
  }

  // рендер лестницы только в рамках выбранного месяца
  async function renderMonthLadder() {
    daysRoot.innerHTML = '';

    const monthStart = new Date(baseMonth.getFullYear(), baseMonth.getMonth(), 1, 12, 0, 0, 0);
    const monthEnd   = new Date(baseMonth.getFullYear(), baseMonth.getMonth() + 1, 0, 12, 0, 0, 0);


    // заголовок месяца
    const title = MTITLE.format(monthStart);
    if (monthTitle) monthTitle.textContent = title.charAt(0).toUpperCase() + title.slice(1);

    // стартовая дата
    let startDate = showPast ? new Date(monthStart)
                             : new Date(Math.max(monthStart.getTime(), TODAY.getTime()));

    // если месяц уже полностью в прошлом и прошлые скрыты — включим их и покажем весь месяц
    if (startDate > monthEnd) {
      showPast = true;
      updatePastBtn();
      startDate = new Date(monthStart);
    }

    // список iso только внутри месяца
    const isoList = [];
    for (let d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
      isoList.push(isoLocal(d));
    }

    if (!isoList.length){
      const stub = document.createElement('div');
      stub.className = 'muted';
      stub.style.padding = '12px';
      stub.textContent = 'Brak dni do wyświetlenia w tym miesiącu.';
      daysRoot.appendChild(stub);
      return;
    }

    // параллельная загрузка
    const CONC = 4;
    let idx = 0;
    const results = new Array(isoList.length);
    async function worker() {
      while (idx < isoList.length) {
        const my = idx++;
        const iso = isoList[my];
        const data = await fetchDay(iso);
        results[my] = { iso, data };
      }
    }
    await Promise.all(Array.from({ length: CONC }, worker));

    // рендер
    results.forEach(({ iso, data }) => {
      const isToday = iso === isoLocal(TODAY);
      const row = dayRow(iso, data || {}, isToday);
      daysRoot.appendChild(row);
    });

    // автоскролл к сегодняшнему, если он в этом месяце
    const anchor = document.getElementById('today-anchor');
    if (anchor) setTimeout(() => anchor.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  // ---------- controls ----------
  $('#prev-month')?.addEventListener('click', () => {
    baseMonth = new Date(baseMonth.getFullYear(), baseMonth.getMonth() - 1, 1);
    renderMonthLadder();
  });
  $('#next-month')?.addEventListener('click', () => {
    baseMonth = new Date(baseMonth.getFullYear(), baseMonth.getMonth() + 1, 1);
    renderMonthLadder();
  });
  $('#jump-today')?.addEventListener('click', () => {
    baseMonth = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
    renderMonthLadder();
  });
  $('#toggle-past')?.addEventListener('click', () => {
    showPast = !showPast;
    updatePastBtn();
    renderMonthLadder();
  });

  // ---------- start ----------
  (async () => {
    await loadMyShifts();
    updatePastBtn();
    renderMonthLadder();
  })();

})();
