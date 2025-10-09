// static/js/start.js
(function initStart(){
  'use strict';
  if (!document.body.classList.contains('page-start')) return;

  // меню (если есть)
  if (typeof window.initMenu === 'function') { try{ window.initMenu(); }catch(_){} }

  // -------- helpers --------
  const $  = (s, r=document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));

  // общий API c токеном
  async function api(url, opts){
    if (typeof window.api === 'function') return await window.api(url, opts||{});
    const headers = new Headers((opts && opts.headers) || {});
    if (opts && opts.body && !(opts.body instanceof FormData) && !headers.has('Content-Type')){
      headers.set('Content-Type','application/json');
    }
    const t = (window.getToken ? window.getToken() :
               (localStorage.getItem('access_token') || sessionStorage.getItem('access_token')));
    if (t) headers.set('Authorization','Bearer '+t);

    const res = await fetch(url, Object.assign({cache:'no-store', headers}, opts||{}));
    const ct  = res.headers.get('content-type')||'';
    const body= ct.includes('application/json') ? await res.json().catch(()=>({})) : await res.text().catch(()=> '');
    if (!res.ok){ const err=new Error(body?.error || ('Błąd '+res.status)); err.status=res.status; throw err; }
    return body;
  }

  // сегодня
  const now  = new Date();
  const iso  = now.toISOString().slice(0,10);
  const wdPl = new Intl.DateTimeFormat('pl-PL', { weekday:'long' }).format(now);
  const dPl  = now.toLocaleDateString('pl-PL', { day:'2-digit', month:'2-digit' });
  const titleEl = $('#today-title'); if (titleEl) titleEl.textContent = `Dziś, ${wdPl} ${dPl}`;

  // claims
  function decodeJWT(t){
    try{ const p=t.split('.')[1]; return JSON.parse(decodeURIComponent(escape(atob(p.replace(/-/g,'+').replace(/_/g,'/'))))); }
    catch(_){ return {}; }
  }
  function currentClaims(){
    if (typeof window.currentClaims === 'function') return window.currentClaims() || {};
    const tok = (localStorage.getItem('access_token') || sessionStorage.getItem('access_token') || '');
    return tok ? decodeJWT(tok) : {};
  }
  const claims = currentClaims();
  const myId   = Number(claims?.sub || claims?.user_id || 0);
  const myName = claims?.full_name || '';

  // заметки может добавлять каждый
  $('#add-note-wrap').hidden = false;

  // элементы
  const els = {
    shiftBox:  $('#today-shift')       || $('#today-shift-status'),
    workBox:   $('#mates-list')        || $('#today-colleagues'),
    notesBox:  $('#notes-list')        || $('#today-notes'),
    workTitle: $('#mates-title')       || $('#work-title')
  };

  function timePL(isoStr){
    let s = String(isoStr || '');
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s = s.replace(' ', 'T');
    if (s && !/[zZ]|[+\-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
    const d = new Date(s);
    return new Intl.DateTimeFormat('pl-PL', {
      hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Europe/Warsaw'
    }).format(d);
  }

  // --------- UI helpers ----------
  function chip(person){
    // нормализуем данные смены
    const lounge   = String(person?.lounge || '').toLowerCase();          // по цвету цифры
    const coordL   = String(person?.coord_lounge || '').toLowerCase();    // по заливке — это и есть «koord na dziś»
    const isCoord  = !!coordL;                                            // показываем «koord.» только если ЕСТЬ coord_lounge!
    const looksBar = /(^|[\/\s])B($|[\/\s])/i.test(String(person?.shift_code || ''));
    const isBar    = person?.is_bar_today ?? looksBar;
    const isZmywak = !!person?.is_zmiwaka;

    const el = document.createElement('span');
    el.className = 'person-chip';

    // мягкие «ореолы» по lounge
    if (lounge === 'mazurek') el.classList.add('chip-mazurek');
    if (lounge === 'polonez') el.classList.add('chip-polonez');

    // роли дня (стили подтянутся из CSS)
    if (isBar)    el.classList.add('chip-bar');
    if (isCoord){
      el.classList.add('chip-coord');
      if (coordL === 'mazurek') el.classList.add('chip-coord-mazurek');
      if (coordL === 'polonez') el.classList.add('chip-coord-polonez');
    }
    if (isZmywak) el.classList.add('chip-zmywak','chip-zmywak-ring');

    // содержимое
    const right = [];
    if (isCoord){
      const cls = coordL === 'mazurek' ? 'lounge-mazurek'
               : coordL === 'polonez' ? 'lounge-polonez' : '';
      right.push(`<span class="badge badge-coord ${cls}">koord.</span>`);
    }
    if (isZmywak) right.push('<span class="badge badge-zmiwaka">zmywak</span>');

    // код показываем как есть (1/2/B и т.д.)
    if (person?.shift_code){
      right.push(`<span class="badge badge-shift">${esc(person.shift_code)}</span>`);
    }

    el.innerHTML = `
      <span class="chip-name">${esc(person?.full_name || '—')}</span>
      <span class="chip-right">${right.join('')}</span>
    `;
    return el;
  }

  function renderNotes(list){
    const box = els.notesBox; if (!box) return;
    box.innerHTML = '';
    if (!Array.isArray(list) || list.length === 0){
      box.innerHTML = '<div class="muted">Brak notatek na dziś.</div>';
      return;
    }
    for (const n of list){
      const row = document.createElement('div');
      row.className = 'row between';
      row.style.cssText = 'gap:8px;padding:8px 0;border-bottom:1px dashed var(--border)';

      const when = timePL(n.created_at);
      const left = document.createElement('div');
      left.innerHTML = `<b>${esc(n.author||'')}</b> <span class="muted">${when}</span>`;

      const right = document.createElement('div');
      right.style.display = 'flex';
      right.style.alignItems = 'center';
      right.style.gap = '10px';
      right.innerHTML = `<div style="max-width:100%">${esc(n.text||'')}</div>`;

      const authorId = n.author_id ?? n.user_id ?? null;
      const isMine = (authorId && myId && String(authorId) === String(myId)) || (myName && n.author === myName);
      if (isMine && n.id != null){
        const del = document.createElement('button');
        del.className = 'btn-link small danger';
        del.type = 'button';
        del.textContent = 'Usuń';
        del.title = 'Usuń notatkę';
        del.addEventListener('click', async ()=>{
          if (!confirm('Usunąć tę notatkę?')) return;
          try{
            await api(`/api/day-notes/${n.id}`, { method:'DELETE' });
            const fresh = await api('/api/day-notes?date='+iso);
            renderNotes(fresh);
          }catch(e){ alert(e.message || 'Błąd usuwania'); }
        });
        right.appendChild(del);
      }

      row.appendChild(left);
      row.appendChild(right);
      box.appendChild(row);
    }
  }

  // ========== Dziś w pracy: Rano/Popo ==========
  let dayCache = { morning:[], evening:[] };
  function renderWork(group){
    const box = els.workBox; if (!box) return;
    box.innerHTML = '';
    if (els.workTitle) els.workTitle.textContent = 'Dziś w pracy:';

    const tabs = document.createElement('div');
    tabs.style.display = 'flex';
    tabs.style.gap = '10px';
    tabs.style.marginBottom = '10px';

    const mCount = (dayCache.morning||[]).length;
    const eCount = (dayCache.evening||[]).length;

    const btnM = document.createElement('button');
    btnM.className = 'pill tab';
    btnM.textContent = `Rano · ${mCount}`;

    const btnE = document.createElement('button');
    btnE.className = 'pill tab';
    btnE.textContent = `Popo · ${eCount}`;

    tabs.append(btnM, btnE);
    box.appendChild(tabs);

    const list = document.createElement('div');
    list.className = 'sg-list';
    box.appendChild(list);

    function setActive(which){
      btnM.classList.toggle('active', which==='morning');
      btnE.classList.toggle('active', which==='evening');
      list.innerHTML = '';
      (which==='morning' ? (dayCache.morning||[]) : (dayCache.evening||[]))
        .forEach(p => list.appendChild(chip(p)));
    }
    btnM.addEventListener('click', ()=> setActive('morning'));
    btnE.addEventListener('click', ()=> setActive('evening'));
    setActive(group || 'morning');
  }

  // ---------- загрузка ----------
  async function loadToday(){
    try{
      const day = await api('/api/day-shifts?date='+iso);
      dayCache = { morning: day.morning||[], evening: day.evening||[] };

      // моя смена
      let my=null, group=null;
      const m = dayCache.morning.find(p=>p.full_name===myName);
      const e = dayCache.evening.find(p=>p.full_name===myName);
      if (m){ my=m; group='morning'; }
      if (e){ my=e; group='evening'; }

      if (els.shiftBox){
        els.shiftBox.innerHTML = my
          ? `Masz dziś zmianę: <span class="badge badge-code">${esc(my.shift_code)}</span>`
          : `Dziś masz wolne.`;
      }

      renderWork(group || 'morning');

      const notes = await api('/api/day-notes?date='+iso);
      renderNotes(notes);

    }catch(e){
      if (els.shiftBox) els.shiftBox.textContent = e.message || 'Błąd';
      if (els.workBox)  els.workBox.innerHTML   = `<div class="muted">${e.message || 'Błąd'}</div>`;
      if (els.notesBox) els.notesBox.innerHTML  = `<div class="muted">${e.message || 'Błąd'}</div>`;
    }
  }

  // ---------- только заметки ----------
  async function loadNotesOnly(){
    try{
      const notes = await api('/api/day-notes?date='+iso);
      renderNotes(notes);
    }catch(e){
      if (els.notesBox) els.notesBox.innerHTML = `<div class="muted">${e.message || 'Błąd'}</div>`;
    }
  }

  // ---------- добавление заметки ----------
  async function addNote(){
    const ta = $('#note-input');
    const txt = (ta && ta.value || '').trim();
    if (!txt) return;
    try{
      await api('/api/day-notes', { method:'POST', body: JSON.stringify({ date: iso, text: txt }) });
      if (ta) ta.value='';
      await loadNotesOnly();
    }catch(e){ alert(e.message || 'Błąd'); }
  }

  // UX textarea
  (function initComposerUX(){
    const ta = $('#note-input'); if (!ta) return;
    function autosize(){ ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,160)+'px'; }
    ta.addEventListener('input', autosize);
    ta.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); $('#note-add')?.click(); }
    });
    autosize();
  })();

  // кнопки
  $('#note-add')?.addEventListener('click', addNote);
  $('#btn-refresh')?.addEventListener('click', loadToday);

  // init
  loadToday();
})();
