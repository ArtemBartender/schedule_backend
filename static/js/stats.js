// ===== Statystyka — pełny moduł z listą moich zmian na dole =====
(async function () {
  if (!document.body.classList.contains('page-stats')) return;

  // Init menu
  if (typeof initMenu === 'function') initMenu();

  // --- helpers ---
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const state = { ym: new Date() }; // bieżący miesiąc

  // nagłówek miesiąca + nawigacja
  const titleEl = $('#stats-title');
  const prevBtn = $('#stats-prev');
  const nextBtn = $('#stats-next');

  // KPI
  const kDone    = $('#kpi-done');
  const kLeft    = $('#kpi-left');
  const kNetDone = $('#kpi-net-done');
  const kNetAll  = $('#kpi-net-all');
  const barsWrap = $('#stats-bars');

  // ustawienia stawek
  const rateInput = $('#rate-input');
  const taxInput  = $('#tax-input');
  const saveBtn   = $('#save-settings');

  // stare pola nadgodzin — скрываем, логика оставлена (редактор открываем из списка)
  const otSelect  = $('#ot-shift-select');
  const otEditBtn = $('#ot-edit-btn');
  const otSummary = $('#ot-summary');
  if (otSelect)  otSelect.closest('.card')?.classList.add('hidden');
  if (otEditBtn) otEditBtn.closest('div')?.classList.add('hidden');
  if (otSummary) otSummary.textContent = '';

  // контейнер для списка смен (создаём, если нет в вёрстке)
  let myList = $('#my-shifts-list');
  if (!myList) {
    const sec = document.createElement('section');
    sec.className = 'card';
    sec.style.padding = '12px';
    sec.style.marginTop = '12px';
    sec.innerHTML = `
      <h3 style="margin:0 0 8px">Moje zmiany w tym miesiącu</h3>
      <div id="my-shifts-list"></div>`;
    $('.container')?.appendChild(sec);
    myList = $('#my-shifts-list');
  }

  const ymStr   = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const fmtPL   = (d) => new Intl.DateTimeFormat('pl-PL', {month:'long', year:'numeric'}).format(d).replace(/^./, c=>c.toUpperCase());
  const fmtDate = (iso) => new Intl.DateTimeFormat('pl-PL',{day:'2-digit',month:'2-digit'}).format(new Date(iso+'T12:00:00'));
  const pln     = (n)=> (n||0).toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})+' zł';

  async function apiJSON(url, opts={}) {
    // используем глобальный api() если есть (с ретраями), иначе обычный fetch
    if (typeof window.api === 'function') return await window.api(url, opts);
    const headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
    if (typeof getToken==='function') headers['Authorization'] = 'Bearer ' + getToken();
    const res = await fetch(url, Object.assign({}, opts, { headers }));
    const data = await res.json().catch(()=> ({}));
    if (!res.ok) throw (data || {error:`HTTP ${res.status}`});
    return data;
  }

  function setMonthTitle(){ if (titleEl) titleEl.textContent = fmtPL(state.ym); }

  // ===== KPI / słupki
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
    try{
      const s = await apiJSON('/api/me/settings');
      if (s.hourly_rate_pln != null && rateInput) rateInput.value = s.hourly_rate_pln;
      if (s.tax_percent     != null && taxInput)  taxInput.value  = s.tax_percent;
    }catch(_){}
  }

  async function loadStats(){
    const data = await apiJSON('/api/my-stats?month='+encodeURIComponent(ymStr(state.ym)));
    if (kDone)    kDone.textContent    = `${data.hours_done} h`;
    if (kLeft)    kLeft.textContent    = `${data.hours_left} h`;
    if (kNetDone) kNetDone.textContent = pln(data.net_done);
    if (kNetAll)  kNetAll.textContent  = pln(data.net_all);
    if (barsWrap) renderBars(data.daily||[]);
  }

  // ===== Modal edycji nadgodzin / notatki
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
          window.toast?.success?.('Zapisano');
          close();
          await refreshAll();
        }catch(err){
          alert(err?.error || 'Błąd zapisu');
        }
      });
    }).catch(()=>{});
  }

  // ===== Список моих смен на месяце (внизу) + действия
  async function renderMyShiftsList(){
    myList.innerHTML = '<div class="muted">Ładowanie…</div>';
    try{
      const list = await apiJSON('/api/my-shifts-brief?month='+encodeURIComponent(ymStr(state.ym)));
      if (!list?.length){
        myList.innerHTML = '<div class="muted">Brak zmian w tym miesiącu.</div>';
        return;
      }

      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.flexDirection = 'column';
      wrap.style.gap = '8px';

      list.forEach(item=>{
        const row = document.createElement('div');
        row.className = 'row between center';
        row.style.padding = '8px 10px';
        row.style.border = '1px solid var(--border)';
        row.style.borderRadius = '12px';

        const left = document.createElement('div');
        left.innerHTML = `
          <b>${fmtDate(item.date)}</b>
          <span class="badge">${item.code || '—'}</span>
          <span class="muted">plan: ${item.scheduled_hours}h${item.worked_hours!=null?` · praca: ${item.worked_hours}h`:''}</span>
        `;

        const right = document.createElement('div');
        right.className = 'row';
        right.style.gap = '6px';
        right.innerHTML = `
          <button class="btn-secondary" data-act="give" data-id="${item.id}">Oddaj na rynek</button>
          <button class="btn-secondary" data-act="edit" data-id="${item.id}">Edytuj godziny</button>
          <button class="btn-secondary" data-act="note" data-id="${item.id}">Dodaj notatkę</button>
        `;

        row.appendChild(left);
        row.appendChild(right);
        wrap.appendChild(row);
      });

      myList.innerHTML = '';
      myList.appendChild(wrap);

      // делегирование кликов по действиям
      myList.onclick = async (ev)=>{
        const btn = ev.target.closest('button[data-act]'); if (!btn) return;
        const id  = btn.dataset.id;
        const act = btn.dataset.act;

        try{
          if (act === 'give'){
            const res = await apiJSON('/api/market/offers/'+id, { method:'POST' });
            if (res.error) throw res;
            alert('Wystawiono zmianę na rynek.');
          } else if (act === 'edit'){
            openOvertimeEditor(id);
          } else if (act === 'note'){
            const txt = prompt('Notatka:');
            if (!txt) return;
            await apiJSON('/api/my-shift/'+id+'/worklog', {
              method:'POST',
              body: JSON.stringify({ note: txt })
            });
            alert('Zapisano notatkę.');
          }
        }catch(e){
          alert(e?.error || e?.message || 'Błąd akcji');
        }
      };

    }catch(err){
      myList.innerHTML = `<div class="muted">${err?.error || 'Błąd ładowania'}</div>`;
    }
  }

  // ===== Notatki (подборка месяца, остаётся как было)
  const notesBox = $('#notes-summary');
  async function loadNotesSummary(){
    if (!notesBox) return;
    const notes = await apiJSON('/api/my-notes?month='+encodeURIComponent(ymStr(state.ym)));
    if (!notes.length){ notesBox.textContent = 'Brak notatek w tym miesiącu.'; return; }
    notesBox.innerHTML = '<div style="font-weight:700;margin-bottom:6px;">Podsumowanie notatek (miesiąc)</div>' +
      notes.map(n=>`<div style="margin:2px 0;"><span class="tag tag-small">${fmtDate(n.date)}</span> — ${String(n.note).replace(/</g,'&lt;')}</div>`).join('');
  }

  // ===== pełne odświeżenie strony
  async function refreshAll(){
    await Promise.all([
      loadStats(),
      renderMyShiftsList(),
      loadNotesSummary()
    ]).catch(()=>{});
  }

  // ===== bindings
  saveBtn?.addEventListener('click', async ()=>{
    try{
      await apiJSON('/api/me/settings', {
        method:'POST',
        body: JSON.stringify({
          hourly_rate_pln: rateInput?.value,
          tax_percent:     taxInput?.value
        })
      });
      window.toast?.success?.('Zapisano ustawienia');
      await refreshAll();
    }catch(err){
      alert(err?.error || 'Błąd zapisu ustawień');
    }
  });

  prevBtn?.addEventListener('click', async ()=>{
    state.ym = new Date(state.ym.getFullYear(), state.ym.getMonth()-1, 1);
    setMonthTitle();
    await refreshAll();
  });
  nextBtn?.addEventListener('click', async ()=>{
    state.ym = new Date(state.ym.getFullYear(), state.ym.getMonth()+1, 1);
    setMonthTitle();
    await refreshAll();
  });

  // ===== init
  setMonthTitle();
  try { await loadSettings(); } catch(_){}
  await refreshAll();
})();
