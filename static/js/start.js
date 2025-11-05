// static/js/start.js
(function initStart(){
  'use strict';
  if (!document.body.classList.contains('page-start')) return;

  // меню (если есть)
  if (typeof window.initMenu === 'function') { try{ window.initMenu(); }catch(_){} }

  // ---------- utils ----------
  const $  = (s, r=document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));

  // общий API с токеном
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

  // дата «сегодня» по Europe/Warsaw
  function todayISO_Warsaw(){
    const s = new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
    const [d,m,y] = s.split(',')[0].trim().split('.').map(x=>parseInt(x,10));
    const dt = new Date(Date.UTC(y, m-1, d));
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth()+1).padStart(2,'0');
    const dd = String(dt.getUTCDate()).padStart(2,'0');
    return `${yy}-${mm}-${dd}`;
  }
  const iso = todayISO_Warsaw();

  // заголовок «Dziś, środa 05.11»
  (function setTodayHeader(){
    try{
      const d = new Date(iso+'T12:00:00Z');
      const wdPl = new Intl.DateTimeFormat('pl-PL', { weekday:'long', timeZone:'UTC' }).format(d);
      const dd   = new Intl.DateTimeFormat('pl-PL', { day:'2-digit', month:'2-digit', timeZone:'UTC' }).format(d);
      $('#today-title') && ($('#today-title').textContent = `Dziś, ${wdPl} ${dd}`);
    }catch(_){}
  })();

  // JWT → claims
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

  // показать блок добавления заметки
  $('#add-note-wrap') && ($('#add-note-wrap').hidden = false);

  // элементы
  const els = {
    shiftBox:  $('#today-shift')       || $('#today-shift-status'),
    workBox:   $('#mates-list')        || $('#today-colleagues'),
    notesBox:  $('#notes-list')        || $('#today-notes'),
    workTitle: $('#mates-title')       || $('#work-title')
  };

  // человеко-пилюля
  function styleAccentByLounge(el, lounge){
    if (!lounge) return;
    const l = String(lounge).toLowerCase();
    if (l === 'mazurek')      el.classList.add('chip-mazurek');
    else if (l === 'polonez') el.classList.add('chip-polonez');
  }
  function badge(text, cls){
    const b = document.createElement('span');
    b.className = `badge ${cls||''}`;
    b.textContent = text;
    return b;
  }
  function chip(person){
    const el = document.createElement('span');
    el.className = 'person-chip';
    el.title = person?.full_name || '';

    const looksBar = /(^|[\/\s])B($|[\/\s])/i.test(String(person?.shift_code || ''));
    const isBar    = person?.is_bar_today ?? looksBar;
    const lounge = (isBar ? 'polonez' : (person?.lounge || '')).toLowerCase();
    styleAccentByLounge(el, lounge);

    const nm = document.createElement('span');
    nm.className = 'name';
    nm.textContent = person?.full_name || '';
    el.appendChild(nm);

    if (isBar) el.appendChild(badge('bar','badge-bar'));
    if (person?.is_coordinator){
      const k = badge('koord.','badge-coord');
      const cl = (person?.coord_lounge || lounge || '').toLowerCase();
      if (cl === 'mazurek') k.classList.add('lounge-mazurek');
      else if (cl === 'polonez') k.classList.add('lounge-polonez');
      el.appendChild(k);
    }
    if (person?.is_zmiwaka){
      el.appendChild(badge('zmywak','badge-zmywak'));
      el.classList.add('chip-zmywak-ring');
    }

    const codeText = String(person?.shift_code || '').trim();
    if (codeText){
      const c = document.createElement('span');
      c.className = 'badge badge-shift';
      c.textContent = codeText;
      el.appendChild(c);
    }
    return el;
  }

  // формат времени
  function timePL(isoStr){
    let s = String(isoStr || '');
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s = s.replace(' ', 'T');
    if (s && !/[zZ]|[+\-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
    const d = new Date(s);
    return new Intl.DateTimeFormat('pl-PL', {
      hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Europe/Warsaw'
    }).format(d);
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

  // ======= Dziś w pracy =======
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

    // сортировка по приоритетам
    const sortWeight = (p) => {
      const isCoord = !!p.is_coordinator;
      const lounge = (p.coord_lounge || p.lounge || '').toLowerCase();
      const isBar = /(^|[\/\s])B($|[\/\s])/i.test(String(p.shift_code || '')) || p.is_bar_today;
      const isZ = !!p.is_zmiwaka;

      if (isZ) return 999;
      if (isCoord && lounge === 'polonez') return 1;
      if (isBar) return 2;
      if (lounge === 'polonez') return 3;
      if (isCoord && lounge === 'mazurek') return 4;
      if (lounge === 'mazurek') return 5;
      return 6;
    };

    function setActive(which){
      btnM.classList.toggle('active', which==='morning');
      btnE.classList.toggle('active', which==='evening');
      list.innerHTML = '';

      const arr = (which==='morning' ? (dayCache.morning||[]) : (dayCache.evening||[]))
        .slice()
        .sort((a,b)=> sortWeight(a)-sortWeight(b));

      arr.forEach(p => list.appendChild(chip(p)));
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

      // сначала работа
      renderWork(group || 'morning');
      // потом заметки
      const notes = await api('/api/day-notes?date='+iso);
      renderNotes(notes);

    }catch(e){
      if (els.shiftBox) els.shiftBox.textContent = e.message || 'Błąd';
      if (els.workBox)  els.workBox.innerHTML   = `<div class="muted">${e.message || 'Błąd'}</div>`;
      if (els.notesBox) els.notesBox.innerHTML  = `<div class="muted">${e.message || 'Błąd'}</div>`;
    }
  }

  async function loadNotesOnly(){
    try{
      const notes = await api('/api/day-notes?date='+iso);
      renderNotes(notes);
    }catch(e){
      if (els.notesBox) els.notesBox.innerHTML = `<div class="muted">${e.message || 'Błąd'}</div>`;
    }
  }

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

  $('#note-add')?.addEventListener('click', addNote);
  $('#btn-refresh')?.addEventListener('click', loadToday);

  loadToday();
})();
