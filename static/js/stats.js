// ===== Statystyka — osobna strona (pełny moduł) =====
(async function () {
  if (!document.body.classList.contains('page-stats')) return;

  // Init menu (hamburger)
  if (typeof initMenu === 'function') initMenu();

  // --- helpers ---
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const state = { ym: new Date() }; // bieżący miesiąc

  const titleEl   = $('#stats-title');
  const prevBtn   = $('#stats-prev');
  const nextBtn   = $('#stats-next');

  const kDone     = $('#kpi-done');
  const kLeft     = $('#kpi-left');
  const kNetDone  = $('#kpi-net-done');
  const kNetAll   = $('#kpi-net-all');
  const barsWrap  = $('#stats-bars');

  const rateInput = $('#rate-input');
  const taxInput  = $('#tax-input');
  const saveBtn   = $('#save-settings');

  const otSelect  = $('#ot-shift-select');
  const otEditBtn = $('#ot-edit-btn');
  const otSummary = $('#ot-summary');
  const notesBox  = $('#notes-summary');

  const ymStr   = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const fmtPL   = (d) => new Intl.DateTimeFormat('pl-PL', {month:'long', year:'numeric'}).format(d).replace(/^./, c=>c.toUpperCase());
  const fmtDate = (iso) => new Intl.DateTimeFormat('pl-PL',{day:'2-digit',month:'2-digit'}).format(new Date(iso+'T12:00:00'));
  const pln     = (n)=> (n||0).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł';

  async function apiJSON(url, opts={}){
    const headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
    if (typeof getToken==='function') headers['Authorization'] = 'Bearer ' + getToken();
    const res = await fetch(url, Object.assign({}, opts, { headers }));
    const data = await res.json().catch(()=> ({}));
    if (!res.ok) throw data;
    return data;
  }

  function setMonthTitle(){ titleEl.textContent = fmtPL(state.ym); }

  function renderBars(daily){
    barsWrap.innerHTML = '';
    if (!daily?.length){ barsWrap.innerHTML = '<div class="muted">Brak danych</div>'; return; }
    const maxH = Math.max(...daily.map(d => d.hours||0), 1);
    const wrap = document.createElement('div'); wrap.className = 'bars';
    daily.forEach(d=>{
      const b = document.createElement('div');
      b.className = 'bar' + (d.done ? ' done' : '');
      b.style.height = (d.hours / maxH * 100) + '%';
      b.setAttribute('data-tip', `${d.date} • ${d.hours}h`);
      wrap.appendChild(b);
    });
    barsWrap.appendChild(wrap);
  }

  async function loadSettings(){
    const s = await apiJSON('/api/me/settings');
    if (s.hourly_rate_pln != null) rateInput.value = s.hourly_rate_pln;
    if (s.tax_percent != null)     taxInput.value  = s.tax_percent;
  }

  async function loadStats(){
    const data = await apiJSON('/api/my-stats?month='+encodeURIComponent(ymStr(state.ym)));
    kDone.textContent    = `${data.hours_done} h`;
    kLeft.textContent    = `${data.hours_left} h`;
    kNetDone.textContent = pln(data.net_done);
    kNetAll.textContent  = pln(data.net_all);
    renderBars(data.daily||[]);
  }

  async function loadOvertimeList(){
    const list = await apiJSON('/api/my-shifts-brief?month='+encodeURIComponent(ymStr(state.ym)));
    otSelect.innerHTML = '';
    if (!list.length){
      const opt = document.createElement('option');
      opt.value = ''; opt.textContent = 'Brak zmian w tym miesiącu';
      otSelect.appendChild(opt);
      otSummary.textContent = '';
      return;
    }
    list.forEach(r=>{
      const opt = document.createElement('option');
      const label = `${fmtDate(r.date)} · ${r.code||''} · plan: ${r.scheduled_hours}h` + (r.worked_hours!=null?` · praca: ${r.worked_hours}h`:``);
      opt.value = String(r.id); opt.textContent = label;
      otSelect.appendChild(opt);
    });
    const cur = list[0];
    otSelect.value = String(cur.id);
    updateOvertimeSummary(cur);
    otSelect.onchange = ()=> {
      const found = list.find(x=> String(x.id) === otSelect.value);
      updateOvertimeSummary(found);
    };
  }
  function updateOvertimeSummary(item){
    if (!item){ otSummary.textContent=''; return; }
    const planned = item.scheduled_hours||0;
    const worked  = (item.worked_hours!=null)? item.worked_hours : null;
    if (worked==null){ otSummary.textContent = `Plan: ${planned}h`; return; }
    const extra = Math.max(0, worked - planned).toFixed(2);
    otSummary.textContent = `Plan: ${planned}h · Praca: ${worked}h · Nadgodziny: ${extra}h`;
  }

  async function loadNotesSummary(){
    const notes = await apiJSON('/api/my-notes?month='+encodeURIComponent(ymStr(state.ym)));
    if (!notes.length){ notesBox.textContent = 'Brak notatek w tym miesiącu.'; return; }
    notesBox.innerHTML = '<div style="font-weight:700;margin-bottom:6px;">Podsumowanie notatek (miesiąc)</div>' +
      notes.map(n=>`<div style="margin:2px 0;"><span class="tag tag-small">${fmtDate(n.date)}</span> — ${String(n.note).replace(/</g,'&lt;')}</div>`).join('');
  }

  // --- Overtime editor ---
  function openOvertimeEditor(shiftId){
    const overlay = document.createElement('div'); overlay.className='modal-backdrop';
    overlay.innerHTML = `
      <div class="modal" style="max-width:560px;">
        <div class="modal-head">
          <div class="modal-title">Edytuj nadgodziny i notatki</div>
          <button class="modal-close" aria-label="Zamknij">×</button>
        </div>
        <div class="modal-body">
          <div class="settings-inline">
            <label>Start<br><input type="time" id="ot-start" /></label>
            <label>Koniec<br><input type="time" id="ot-end" /></label>
            <label>Przepracowano (h)<br><input type="number" id="ot-worked" step="0.01" placeholder="auto z czasu" /></label>
          </div>
          <div class="muted" id="ot-hint" style="margin:8px 0;"></div>
          <label>Notatka (co zrobiłeś / dlaczego zostałeś)<br>
            <textarea id="ot-note" rows="5" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--card2);color:var(--text);"></textarea>
          </label>
          <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">
            <button class="btn-secondary" id="ot-cancel">Anuluj</button>
            <button class="btn-secondary" id="ot-save">Zapisz</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = ()=>overlay.remove();
    overlay.addEventListener('click', e=>{ if (e.target===overlay || e.target.classList.contains('modal-close')) close(); });

    // load details
    apiJSON('/api/my-shift/'+shiftId).then(data=>{
      const hint = $('#ot-hint', overlay);
      if (data.default_start && data.default_end){
        hint.textContent = `Domyślne godziny: ${data.default_start}–${data.default_end}`;
        $('#ot-start', overlay).value = data.default_start;
        $('#ot-end', overlay).value   = data.default_end;
      } else hint.textContent = 'Brak domyślnych godzin dla tego kodu.';

      if (data.worked_hours != null) $('#ot-worked', overlay).value = data.worked_hours;
      if (data.note) $('#ot-note', overlay).value = data.note;

      const startEl  = $('#ot-start', overlay);
      const endEl    = $('#ot-end', overlay);
      const workedEl = $('#ot-worked', overlay);

      function recompute(){
        const s = startEl.value, e = endEl.value;
        if (!s || !e) return;
        const [sh,sm] = s.split(':').map(Number);
        const [eh,em] = e.split(':').map(Number);
        let mins = (eh*60+em) - (sh*60+sm);
        if (mins < 0) mins += 24*60;
        workedEl.value = (mins/60).toFixed(2);
      }
      startEl.addEventListener('change', recompute);
      endEl.addEventListener('change', recompute);

      $('#ot-cancel', overlay).addEventListener('click', close);
      $('#ot-save',   overlay).addEventListener('click', async ()=>{
        try{
          await apiJSON('/api/my-shift/'+shiftId+'/worklog', {
            method:'POST',
            body: JSON.stringify({
              start_time: startEl.value || null,
              end_time:   endEl.value   || null,
              worked_hours: workedEl.value || null,
              note: $('#ot-note', overlay).value || ''
            })
          });
          window.toast?.ok?.('Zapisano');
          close();
          await refreshAll(); // reload KPIs, bars, list & notes
        }catch(err){
          alert(err?.error || 'Błąd zapisu');
        }
      });
    }).catch(()=>{});
  }

  // --- page refresh ---
  async function refreshAll(){
    await Promise.all([
      loadStats(),
      loadOvertimeList(),
      loadNotesSummary()
    ]).catch(()=>{});
  }

  // --- bindings ---
  saveBtn.addEventListener('click', async ()=>{
    try{
      await apiJSON('/api/me/settings', {
        method:'POST',
        body: JSON.stringify({
          hourly_rate_pln: rateInput.value,
          tax_percent:     taxInput.value
        })
      });
      window.toast?.ok?.('Zapisano ustawienia');
      await refreshAll();
    }catch(err){
      alert(err?.error || 'Błąd zapisu ustawień');
    }
  });

  prevBtn.addEventListener('click', async ()=>{
    state.ym = new Date(state.ym.getFullYear(), state.ym.getMonth()-1, 1);
    setMonthTitle();
    await refreshAll();
  });
  nextBtn.addEventListener('click', async ()=>{
    state.ym = new Date(state.ym.getFullYear(), state.ym.getMonth()+1, 1);
    setMonthTitle();
    await refreshAll();
  });

  otEditBtn.addEventListener('click', ()=>{
    const id = otSelect.value;
    if (id) openOvertimeEditor(id);
  });

  // --- init ---
  setMonthTitle();
  try { await loadSettings(); } catch(e){}
  await refreshAll();
})();
