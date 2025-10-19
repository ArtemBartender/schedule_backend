(function initControl(){
  'use strict';
  if (!document.body.classList.contains('page-control')) return;

  if (typeof window.initMenu === 'function') window.initMenu();

  const content = document.getElementById('control-content');
  if (!content) return;

  const $ = s => document.querySelector(s);
  const el = (t,c)=>{const e=document.createElement(t); if(c)e.className=c; return e;};
  const toast = window.toast || {success:alert,error:alert,info:alert};

  let USERS = [];
  let STATE = { ym: new Date() };

  const ymStr = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  async function api(path, opts){ return await window.api(path, opts||{}); }

  async function loadUsers(){
    try{ USERS = await api('/api/users'); }
    catch(_){ USERS = []; }
  }

  function fillUsers(select){
    select.innerHTML = USERS.map(u=>`<option value="${u.id}">${u.full_name}</option>`).join('');
  }

  function buildDaysSelect(select){
    const y = STATE.ym.getFullYear(), m = STATE.ym.getMonth();
    const last = new Date(y, m+1, 0).getDate();
    select.innerHTML = '';
    for (let d=1; d<=last; d++){
      const iso = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const opt = document.createElement('option');
      opt.value = iso; opt.textContent = iso;
      select.appendChild(opt);
    }
  }

  function openModal(html){
    const m = el('div','modal-backdrop');
    m.innerHTML = `<div class="modal">${html}</div>`;
    document.body.appendChild(m);
    const doClose = ()=> m.remove();
    m.addEventListener('click', e=>{
      if (e.target===m || e.target.classList.contains('modal-close')) doClose();
    });
    return {root:m, doClose};
  }

  // ======= MODALS =======

  async function onLate(){
    const modal = openModal(`
    const root = modal.root;
    const doClose = modal.doClose;

      <div class="modal-head">
        <div class="modal-title">Dodaj spóźnienie</div>
        <button class="modal-close">×</button>
      </div>
      <div class="modal-body">
        <label>Pracownik</label><select id="late-user"></select>
        <label>Dzień</label><select id="late-date"></select>
        <label>Na ile minut spóźnienia</label><input id="late-minutes" type="number" min="1">
        <label>Faktyczne godziny pracy</label>
        <div style="display:flex; gap:6px;">
          <input id="late-from" type="time"> do <input id="late-to" type="time">
        </div>
        <label>Powód (opcjonalnie)</label><input id="late-reason" type="text">
        <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn-secondary modal-close">Anuluj</button>
          <button class="btn-primary" id="late-save">Zapisz</button>
        </div>
      </div>
    `);
    const u = root.querySelector('#late-user');
    const d = root.querySelector('#late-date');
    fillUsers(u); buildDaysSelect(d);

    root.querySelector('#late-save').addEventListener('click', async ()=>{
      try{
        await api('/api/control/late', {
          method:'POST',
          body: JSON.stringify({
            user_id: Number(u.value),
            date: d.value,
            reason: root.querySelector('#late-reason').value || '',
            delay_minutes: parseInt(root.querySelector('#late-minutes').value || '0'),
            time_from: root.querySelector('#late-from').value,
            time_to: root.querySelector('#late-to').value
          })
        });
        toast.success('Zapisano spóźnienie');
        doClose(); await renderSummary();
      }catch(e){ toast.error(e.message || 'Błąd'); }
    });
  }

  async function onExtra(){
    const {root, doClose} = openModal(`
      <div class="modal-head"><div class="modal-title">Dodaj dodatkowe godziny</div><button class="modal-close">×</button></div>
      <div class="modal-body">
        <label>Pracownik</label><select id="extra-user"></select>
        <label>Dzień</label><select id="extra-date"></select>
        <label>Powód</label><input id="extra-reason" type="text">
        <label>Ilość godzin</label><input id="extra-hours" type="number" min="0.5" step="0.5">
        <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn-secondary modal-close">Anuluj</button>
          <button class="btn-primary" id="extra-save">Zapisz</button>
        </div>
      </div>
    `);
    const u = root.querySelector('#extra-user');
    const d = root.querySelector('#extra-date');
    fillUsers(u); buildDaysSelect(d);

    root.querySelector('#extra-save').addEventListener('click', async ()=>{
      const hours = parseFloat(root.querySelector('#extra-hours').value || '0');
      if (!(hours>0)) return toast.error('Podaj ilość godzin');
      try{
        await api('/api/control/extra', {method:'POST', body: JSON.stringify({
          user_id:Number(u.value), date:d.value,
          reason: root.querySelector('#extra-reason').value || '',
          hours
        })});
        toast.success('Zapisano dodatkowe godziny');
        doClose(); await renderSummary();
      }catch(e){ toast.error(e.message || 'Błąd'); }
    });
  }

  async function onAbsence(){
    const {root, doClose} = openModal(`
      <div class="modal-head"><div class="modal-title">Zgłoś nieobecność</div><button class="modal-close">×</button></div>
      <div class="modal-body">
        <label>Pracownik</label><select id="abs-user"></select>
        <label>Dzień</label><select id="abs-date"></select>
        <label>Powód</label><input id="abs-reason" type="text">
        <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn-secondary modal-close">Anuluj</button>
          <button class="btn-primary" id="abs-save">Zapisz</button>
        </div>
      </div>
    `);
    const u = root.querySelector('#abs-user');
    const d = root.querySelector('#abs-date');
    fillUsers(u); buildDaysSelect(d);

    root.querySelector('#abs-save').addEventListener('click', async ()=>{
      try{
        await api('/api/control/absence', {method:'POST', body: JSON.stringify({
          user_id:Number(u.value), date:d.value,
          reason: root.querySelector('#abs-reason').value || ''
        })});
        toast.success('Zapisano nieobecność');
        doClose(); await renderSummary();
      }catch(e){ toast.error(e.message || 'Błąd'); }
    });
  }

  async function onShift(){
    const {root, doClose} = openModal(`
      <div class="modal-head"><div class="modal-title">Dodaj zmianę</div><button class="modal-close">×</button></div>
      <div class="modal-body">
        <label>Pracownik</label><select id="sh-user"></select>
        <label>Dzień</label><select id="sh-date"></select>
        <label>Powód</label><input id="sh-reason" type="text">
        <label>Godziny</label>
        <div style="display:flex; gap:6px;">
          <input id="sh-from" type="time"> do <input id="sh-to" type="time">
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn-secondary modal-close">Anuluj</button>
          <button class="btn-primary" id="sh-save">Zapisz</button>
        </div>
      </div>
    `);
    const u = root.querySelector('#sh-user'); const d = root.querySelector('#sh-date');
    fillUsers(u); buildDaysSelect(d);

    root.querySelector('#sh-save').addEventListener('click', async ()=>{
      const from = root.querySelector('#sh-from').value;
      const to   = root.querySelector('#sh-to').value;
      if (!from || !to) return toast.error('Podaj godziny');
      try{
        await api('/api/control/add-shift', {method:'POST', body: JSON.stringify({
          user_id:Number(u.value), date:d.value,
          reason: root.querySelector('#sh-reason').value || '',
          from, to
        })});
        toast.success('Dodano zmianę');
        doClose(); await renderSummary();
      }catch(e){ toast.error(e.message || 'Błąd'); }
    });
  }

  // --- Удаление событий ---
  function onDeleteEvent(eventId) {
  const modal = openModal(`
    <div class="modal-head">
      <div class="modal-title">Usuń zdarzenie</div>
      <button class="modal-close">×</button>
    </div>
    <div class="modal-body">
      <p>Podaj powód usunięcia:</p>
      <textarea id="delete-reason" rows="3" style="width:100%"></textarea>
      <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn-secondary modal-close">Anuluj</button>
        <button class="btn-danger" id="confirm-delete">Usuń</button>
      </div>
    </div>
  `);

  // 👉 вот эти две строки обязательны
  const root = modal.root;
  const doClose = modal.doClose;

  root.querySelector('#confirm-delete').addEventListener('click', async () => {
    const reason = root.querySelector('#delete-reason').value.trim();
    if (!reason) return toast.error('Podaj powód!');
    try {
      await api('/api/control/delete', {
        method: 'POST',
        body: JSON.stringify({ id: eventId, reason })
      });
      toast.success('Zdarzenie usunięte');
      doClose();
      await renderSummary();
    } catch (e) {
      toast.error(e.message || 'Błąd przy usuwaniu');
    }
  });
}


  // ======= Summary =======
  async function renderSummary(){
    const box = content;
    box.innerHTML = `
      <div class="row between center" style="margin-bottom:10px;">
        <div class="muted" id="month-title"></div>
        <div class="row" style="gap:6px">
          <button class="btn-secondary" id="ctl-prev">◀</button>
          <button class="btn-secondary" id="ctl-next">▶</button>
        </div>
      </div>
      <div class="card" style="padding:12px">
        <h3 style="margin:0 0 8px">Skrót zdarzeń</h3>
        <div id="events-list"></div>
      </div>
      <div class="card" style="padding:12px; margin-top:12px">
        <h3 style="margin:0 0 8px">Obsada (norma 12)</h3>
        <div id="staffing-table"></div>
      </div>
    `;

    const title = new Intl.DateTimeFormat('pl-PL',{month:'long', year:'numeric'}).format(STATE.ym);
    $('#month-title').textContent = title.charAt(0).toUpperCase()+title.slice(1);

    $('#ctl-prev').addEventListener('click', ()=>{ STATE.ym = new Date(STATE.ym.getFullYear(), STATE.ym.getMonth()-1, 1); renderSummary(); });
    $('#ctl-next').addEventListener('click', ()=>{ STATE.ym = new Date(STATE.ym.getFullYear(), STATE.ym.getMonth()+1, 1); renderSummary(); });

    let data;
    try{ data = await api('/api/control/summary?month='+encodeURIComponent(ymStr(STATE.ym))); }
    catch(e){ $('#events-list').innerHTML = `<div class="muted">${e.message || 'Błąd'}</div>`; return; }

    const evWrap = $('#events-list');
    const mapName = {late:'Spóźnienie', extra:'Dodatkowe godziny', absence:'Nieobecność', manual_shift:'Dodana zmiana'};
    if (!data.events?.length) evWrap.innerHTML = '<div class="muted">Brak zdarzeń.</div>';
    else {
      const list = el('div','col');
      data.events.forEach(e=>{
        const row = el('div','row between');
        row.style.padding = '6px 0'; row.style.borderBottom = '1px solid var(--border)';
        row.innerHTML = `
          <div>
            <span class="tag tag-small">${mapName[e.kind]||e.kind}</span>
            <b>${e.user||''}</b> — ${e.date}
            ${e.hours?` · ${e.hours}h`:''}
            ${e.time_from?` · ${e.time_from}-${e.time_to}`:''}
            ${e.delay_minutes?` · spóźnienie ${e.delay_minutes} min`:''}
          </div>
          <div class="row center" style="gap:6px;">
            <div class="muted small">${e.reason?e.reason:''}</div>
            <button class="icon-btn" title="Usuń" data-id="${e.id}">🗑️</button>
          </div>
        `;
        row.querySelector('button.icon-btn').addEventListener('click', ()=>onDeleteEvent(e.id));
        list.appendChild(row);
      });
      evWrap.appendChild(list);
    }

    // staffing
    const st = $('#staffing-table');
    const tbl = el('table','table');
    tbl.innerHTML = `<thead><tr><th>Data</th><th>Rano</th><th>Δ</th><th>Popo</th><th>Δ</th></tr></thead><tbody></tbody>`;
    const tb = tbl.querySelector('tbody');
    (data.staffing||[]).forEach(r=>{
      const tr = document.createElement('tr');
      const cls1 = r.morning_delta<0?'neg':(r.morning_delta>0?'pos':'');
      const cls2 = r.evening_delta<0?'neg':(r.evening_delta>0?'pos':'');
      tr.innerHTML = `
        <td>${r.date}</td>
        <td>${r.morning}</td><td class="${cls1}">${r.morning_delta}</td>
        <td>${r.evening}</td><td class="${cls2}">${r.evening_delta}</td>
      `;
      tb.appendChild(tr);
    });
    st.appendChild(tbl);

    // Deleted log
    const logBox = el('div','card');
    logBox.style.marginTop = '12px';
    logBox.innerHTML = `<h3>Usunięte zdarzenia</h3><div id="deleted-log"></div>`;
    box.appendChild(logBox);

    try {
      const log = await api('/api/control/deleted');
      const wrap = logBox.querySelector('#deleted-log');
      if (!log.length) wrap.innerHTML = '<div class="muted">Brak usunięć</div>';
      else {
        const list = el('div','col');
        log.forEach(l=>{
          const div = el('div','small muted');
          div.textContent = `${l.deleted_at} — ${l.user_name} usunął zdarzenie #${l.event_id}: ${l.reason}`;
          list.appendChild(div);
        });
        wrap.appendChild(list);
      }
    } catch(e){ console.warn('no log', e); }
  }

  document.getElementById('btn-late')?.addEventListener('click', onLate);
  document.getElementById('btn-extra')?.addEventListener('click', onExtra);
  document.getElementById('btn-absence')?.addEventListener('click', onAbsence);
  document.getElementById('btn-shift')?.addEventListener('click', onShift);

  (async ()=>{ await loadUsers(); await renderSummary(); })();

})();
