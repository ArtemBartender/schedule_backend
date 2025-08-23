// ===== Start page (next shift + day notes) =====
(function(){
  if (!document.body.classList.contains('page-start')) return;
  if (typeof initMenu === 'function') initMenu();

  const $ = (s, r=document)=>r.querySelector(s);

  const box      = $('#next-shift-box');
  const btnOpen  = $('#open-day');
  const notesBox = $('#notes-list');
  const addWrap  = $('#add-note-wrap');
  const noteInp  = $('#note-input');
  const noteAdd  = $('#note-add');

  let nextDateISO = null;

  function claims(){ try{ return (typeof currentClaims==='function') ? currentClaims() : {}; }catch(_){ return {}; } }
  async function api(url, opts={}){
    const headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
    if (typeof getToken==='function') headers['Authorization'] = 'Bearer ' + getToken();
    const res = await fetch(url, Object.assign({}, opts, {headers}));
    const data = await res.json().catch(()=> ({}));
    if (!res.ok) throw data;
    return data;
  }

  function fmtLong(iso){
    const d = new Date(iso+'T12:00:00');
    return new Intl.DateTimeFormat('pl-PL',{weekday:'long', day:'numeric', month:'long', year:'numeric'}).format(d).replace(/^./,m=>m.toUpperCase());
  }

  function renderNext(data){
    if (data.empty){
      box.textContent = 'Brak zmian w grafiku.';
      btnOpen.disabled = true;
      return;
    }
    const prog = `${Math.min(data.month_done, data.month_total)}/${data.month_total}`;
    box.innerHTML = `
      <div style="font-size:1.05rem;font-weight:800">${fmtLong(data.date)}</div>
      <div class="muted">Kod: <b>${(data.code||'—')}</b> · Godziny: <b>${data.hours}h</b></div>
      <div class="muted">To będzie zmiana nr <b>${prog}</b> w tym miesiącu</div>
    `;
    nextDateISO = data.date;
    btnOpen.disabled = false;
  }

  function renderNotes(list){
    if (!list.length){ notesBox.innerHTML = '<div class="muted">Brak notatek.</div>'; return; }
    notesBox.innerHTML = list.map(n => `
      <div class="note-row" data-id="${n.id}" style="padding:8px 10px;border:1px solid var(--border);border-radius:10px;margin:6px 0;background:var(--panel)">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
          <div><b>${n.author || '—'}</b> <span class="muted small">${new Date(n.created_at).toLocaleString('pl-PL')}</span></div>
          <button class="btn-secondary btn-del" data-id="${n.id}" title="Usuń" style="padding:4px 8px;">×</button>
        </div>
        <div style="margin-top:6px;white-space:pre-wrap;">${String(n.text).replace(/</g,'&lt;')}</div>
      </div>
    `).join('');

    // кнопка удалить — только для коорди/админа
    if (!(claims().role==='admin' || claims().role==='coordinator')){
      notesBox.querySelectorAll('.btn-del').forEach(b=> b.remove());
    } else {
      notesBox.querySelectorAll('.btn-del').forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          try{
            await api('/api/day-notes/'+btn.dataset.id, { method:'DELETE' });
            loadNotes(); toast?.info?.('Usunięto notatkę');
          }catch(err){ alert(err?.error || 'Błąd'); }
        });
      });
    }
  }

  async function loadNext(){
    const data = await api('/api/next-shift');
    renderNext(data);
  }

  async function loadNotes(){
    if (!nextDateISO){ notesBox.innerHTML = ''; return; }
    const list = await api('/api/day-notes?date='+encodeURIComponent(nextDateISO));
    renderNotes(list);
  }

  // actions
  btnOpen.addEventListener('click', ()=>{
    // простой переход в календарь — на нужный месяц
    window.location.href = '/dashboard';
  });

  if (claims().role==='admin' || claims().role==='coordinator'){
    addWrap.hidden = false;
    noteAdd.addEventListener('click', async ()=>{
      const txt = (noteInp.value||'').trim();
      if (!txt) return;
      try{
        await api('/api/day-notes', { method:'POST', body: JSON.stringify({ date: nextDateISO, text: txt }) });
        noteInp.value = '';
        toast?.ok?.('Dodano notatkę');
        loadNotes();
      }catch(err){ alert(err?.error || 'Błąd'); }
    });
  }

  // init
  loadNext().then(loadNotes).catch(()=>{ box.textContent='Błąd ładowania'; });
})();
