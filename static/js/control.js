(function initControl() {
  'use strict';
  if (!document.body.classList.contains('page-control')) return;
  if (typeof window.initMenu === 'function') window.initMenu();

  const content = document.getElementById('control-content');
  if (!content) return;

  const $ = s => document.querySelector(s);
  const el = (t, c) => { const e = document.createElement(t); if (c) e.className = c; return e; };
  const toast = {
    success: (msg) => (window.toast?.success ? window.toast.success(String(msg)) : alert(msg)),
    error:   (msg) => (window.toast?.error   ? window.toast.error(String(msg))   : alert(msg)),
    info:    (msg) => (window.toast?.info    ? window.toast.info(String(msg))    : alert(msg))
  };

  // Заменяем стандартный alert на всплывающие уведомления
  function showToast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast-message ${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('visible'), 10);
    setTimeout(() => {
      el.classList.remove('visible');
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }
  
  // используем его везде вместо toast.success(...)
  toast.success = (msg) => showToast(msg, 'success');
  toast.error = (msg) => showToast(msg, 'error');
  toast.info = (msg) => showToast(msg, 'info');

  
  let USERS = [];
  let STATE = { ym: new Date() };

  const ymStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  async function api(path, opts) { return await window.api(path, opts || {}); }

  async function loadUsers() {
    try { USERS = await api('/api/users'); } catch { USERS = []; }
  }

  function fillUsers(select) {
    select.innerHTML = USERS.map(u => `<option value="${u.id}">${u.full_name}</option>`).join('');
  }

  function buildDaysSelect(select) {
    const y = STATE.ym.getFullYear(), m = STATE.ym.getMonth();
    const last = new Date(y, m + 1, 0).getDate();
    select.innerHTML = '';
    for (let d = 1; d <= last; d++) {
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const opt = document.createElement('option');
      opt.value = iso; opt.textContent = iso;
      select.appendChild(opt);
    }
  }

  function openModalFromTemplate(tplId) {
  const tpl = document.getElementById(tplId);
  if (!tpl) throw new Error('Nie znaleziono template: ' + tplId);

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.appendChild(tpl.content.cloneNode(true));

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // ✅ безопасный способ закрытия
  const doClose = () => {
    if (backdrop && backdrop.parentNode) {
      backdrop.parentNode.removeChild(backdrop);
    }
  };

  backdrop.addEventListener('click', e => {
    if (e.target === backdrop || e.target.classList.contains('modal-close')) {
      doClose();
    }
  });

  return { root: modal, doClose };
}


  // ======= MODALS =======

  async function onLate() {
    const { root, doClose } = openModalFromTemplate('tpl-late');
    const u = root.querySelector('#late-user'), d = root.querySelector('#late-date');
    fillUsers(u); buildDaysSelect(d);
    root.querySelector('#late-save').addEventListener('click', async () => {
      try {
        await api('/api/control/late', {
          method: 'POST',
          body: JSON.stringify({
            user_id: Number(u.value),
            date: d.value,
            reason: root.querySelector('#late-reason').value || '',
            delay_minutes: parseInt(root.querySelector('#late-minutes').value || '0'),
            time_from: root.querySelector('#late-from').value,
            time_to: root.querySelector('#late-to').value
          })
        });
        toast.success('Zapisano spóźnienie'); doClose(); await renderSummary();
      } 
      catch (e) { toast.error(e.message || 'Błąd'); }
    });
  }

  async function onExtra() {
    const { root, doClose } = openModalFromTemplate('tpl-extra');
    const u = root.querySelector('#extra-user'), d = root.querySelector('#extra-date');
    fillUsers(u); buildDaysSelect(d);
    root.querySelector('#extra-save').addEventListener('click', async () => {
      const hours = parseFloat(root.querySelector('#extra-hours').value || '0');
      if (!(hours > 0)) return toast.error('Podaj ilość godzin');
      try {
        await api('/api/control/extra', {
          method: 'POST',
          body: JSON.stringify({
            user_id: Number(u.value), date: d.value,
            reason: root.querySelector('#extra-reason').value || '', hours
          })
        });
        toast.success('Zapisano dodatkowe godziny'); doClose(); await renderSummary();
      } catch (e) { toast.error(e.message || 'Błąd'); }
    });
  }

  async function onAbsence() {
    const { root, doClose } = openModalFromTemplate('tpl-absence');
    const u = root.querySelector('#abs-user'), d = root.querySelector('#abs-date');
    fillUsers(u); buildDaysSelect(d);
    root.querySelector('#abs-save').addEventListener('click', async () => {
      try {
        await api('/api/control/absence', {
          method: 'POST',
          body: JSON.stringify({
            user_id: Number(u.value), date: d.value,
            reason: root.querySelector('#abs-reason').value || ''
          })
        });
        toast.success('Zapisano nieobecność'); doClose(); await renderSummary();
      } catch (e) { toast.error(e.message || 'Błąd'); }
    });
  }

  async function onShift() {
    const { root, doClose } = openModalFromTemplate('tpl-shift');
    const u = root.querySelector('#sh-user'), d = root.querySelector('#sh-date');
    fillUsers(u); buildDaysSelect(d);
    root.querySelector('#sh-save').addEventListener('click', async () => {
      const from = root.querySelector('#sh-from').value;
      const to = root.querySelector('#sh-to').value;
      if (!from || !to) return toast.error('Podaj godziny');
      try {
        await api('/api/control/add-shift', {
          method: 'POST',
          body: JSON.stringify({
            user_id: Number(u.value), date: d.value,
            reason: root.querySelector('#sh-reason').value || '', from, to
          })
        });
        toast.success('Dodano zmianę'); doClose(); await renderSummary();
      } catch (e) { toast.error(e.message || 'Błąd'); }
    });
  }

  function onDeleteEvent(eventId) {
    const { root, doClose } = openModalFromTemplate('tpl-delete');
  
    const closeSafely = () => {
      try { doClose(); } catch (_) { try { root.closest('.modal-backdrop')?.remove(); } catch {} }
    };
  
    root.querySelector('#confirm-delete').addEventListener('click', async (ev) => {
      ev.preventDefault();
      const reason = root.querySelector('#delete-reason').value.trim();
      if (!reason) return toast.error('Podaj powód!');
      try {
        await api('/api/control/delete', {
          method: 'POST',
          body: JSON.stringify({ id: eventId, reason })
        });
        toast.success('Zdarzenie usunięte');
        closeSafely();
        setTimeout(() => renderSummary(), 200);
      } 
      catch (e) {
        console.error('Delete error:', e);
        const msg = (e && e.message) ? e.message : 'Błąd przy usuwaniu';
        toast.error(String(msg));
      }

    });
  }


  // ======= Summary =======
  async function renderSummary() {
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
  
      <div class="card deleted-log" style="margin-top:12px;">
        <h3 style="margin-bottom:8px;">🗑️ Usunięte zdarzenia</h3>
        <table class="table deleted-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Kto usunął</th>
              <th>Powód</th>
              <th>ID zdarzenia</th>
            </tr>
          </thead>
          <tbody id="deleted-log">
            <tr><td colspan="4" class="muted">Wczytywanie...</td></tr>
          </tbody>
        </table>
      </div>
    `;
  
    // === Заголовок месяца ===
    const title = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' }).format(STATE.ym);
    $('#month-title').textContent = title.charAt(0).toUpperCase() + title.slice(1);
  
    $('#ctl-prev').addEventListener('click', () => {
      STATE.ym = new Date(STATE.ym.getFullYear(), STATE.ym.getMonth() - 1, 1);
      renderSummary();
    });
    $('#ctl-next').addEventListener('click', () => {
      STATE.ym = new Date(STATE.ym.getFullYear(), STATE.ym.getMonth() + 1, 1);
      renderSummary();
    });
  
    // === Загрузка данных ===
    let data;
    try {
      data = await api('/api/control/summary?month=' + encodeURIComponent(ymStr(STATE.ym)));
    } catch (e) {
      $('#events-list').innerHTML = `<div class="muted">${e.message || 'Błąd'}</div>`;
      return;
    }
  
    // === Список событий ===
    const evWrap = $('#events-list');
    const mapName = {
      late: 'Spóźnienie',
      extra: 'Dodatkowe godziny',
      absence: 'Nieobecność',
      manual_shift: 'Dodana zmiana'
    };
  
    if (!data.events?.length) {
      evWrap.innerHTML = '<div class="muted">Brak zdarzeń.</div>';
    } else {
      const list = el('div', 'col');
      data.events.forEach(e => {
        const row = el('div', 'row between');
        row.style.padding = '6px 0';
        row.style.borderBottom = '1px solid var(--border)';
        row.innerHTML = `
          <div>
            <span class="tag tag-small">${mapName[e.kind] || e.kind}</span>
            <b>${e.user || ''}</b> — ${e.date}
            ${e.hours ? ` · ${e.hours}h` : ''}
            ${e.time_from ? ` · ${e.time_from}-${e.time_to}` : ''}
            ${e.delay_minutes ? ` · spóźnienie ${e.delay_minutes} min` : ''}
          </div>
          <div class="row center" style="gap:6px;">
            <div class="muted small">${e.reason ? e.reason : ''}</div>
            <button class="icon-btn" title="Usuń" data-id="${e.id}">🗑️</button>
          </div>
        `;
        row.querySelector('button.icon-btn').addEventListener('click', async () => {
          await onDeleteEvent(e.id);
          await renderDeletedLog(); // автообновление после удаления
        });
        list.appendChild(row);
      });
      evWrap.appendChild(list);
    }
  
    // === Таблица Obsada ===
    const st = $('#staffing-table');
    const tbl = el('table', 'table staffing');
    tbl.innerHTML = `
      <thead>
        <tr>
          <th>Data</th>
          <th>Rano</th><th>Δ</th>
          <th>Popołudnie</th><th>Δ</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tb = tbl.querySelector('tbody');
  
    (data.staffing || []).forEach(r => {
      const tr = document.createElement('tr');
      const cls1 = r.morning_delta < 0 ? 'neg' : r.morning_delta > 0 ? 'pos' : '';
      const cls2 = r.evening_delta < 0 ? 'neg' : r.evening_delta > 0 ? 'pos' : '';
      tr.innerHTML = `
        <td><b>${r.date}</b></td>
        <td>${r.morning}</td><td class="${cls1}">${r.morning_delta}</td>
        <td>${r.evening}</td><td class="${cls2}">${r.evening_delta}</td>
      `;
      tb.appendChild(tr);
    });
    st.appendChild(tbl);
  
    // === История удалений ===
    try {
      const tbody = document.querySelector('#deleted-log');
      const log = await api('/api/control/deleted');
      if (!log.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="muted">Brak usunięć</td></tr>`;
      } else {
        tbody.innerHTML = '';
        log.forEach(l => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${new Date(l.deleted_date).toLocaleDateString('pl-PL')}</td>

            <td>${l.user_name || '-'}</td>
            <td>${l.reason || '-'}</td>
            <td>#${l.event_id}</td>
          `;
          tbody.appendChild(tr);
        });
      }
    } catch (e) {
      console.warn('no log', e);
    }
  }


  document.getElementById('btn-late')?.addEventListener('click', onLate);
  document.getElementById('btn-extra')?.addEventListener('click', onExtra);
  document.getElementById('btn-absence')?.addEventListener('click', onAbsence);
  document.getElementById('btn-shift')?.addEventListener('click', onShift);

  (async () => { await loadUsers(); await renderSummary(); })();

  async function showDeletedDetails(eventId) {
    try {
      const data = await api(`/api/control/deleted/${eventId}`, { method: 'GET' });

      const modal = document.createElement('div');
      modal.className = 'modal-backdrop';
      modal.innerHTML = `
        <div class="modal">
          <h3>🗑️ Szczegóły usuniętego zdarzenia</h3>
          <div class="modal-content">
            <p><b>ID zdarzenia:</b> #${data.event_id}</p>
            <p><b>Rodzaj:</b> ${data.kind || '—'}</p>
            <p><b>Data zdarzenia:</b> ${
              data.event_date ? new Date(data.event_date).toLocaleDateString('pl-PL') : '—'
            }</p>
            <p><b>Godziny:</b> ${data.time_from || '?'} - ${data.time_to || '?'}</p>
            <p><b>Ilość godzin:</b> ${data.hours || '—'}</p>
            <p><b>Osoba:</b> ${data.user_name || '—'}</p>
            <hr>
            <p><b>Usunięto przez:</b> ${data.deleted_by_name || '—'}</p>
            <p><b>Data usunięcia:</b> ${
              data.deleted_date
                ? new Date(data.deleted_date).toLocaleDateString('pl-PL')
                : '—'
            }</p>
            <p><b>Powód:</b> ${data.reason || '—'}</p>
          </div>
          <div class="modal-actions">
            <button class="btn-secondary" id="close-modal">Zamknij</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
  
      document.querySelector('#close-modal').addEventListener('click', () => modal.remove());
    } catch (err) {
      toast.error('Błąd: ' + err.message);
    }
  }

  // === Удалённые события ===
  async function renderDeletedLog() {
    const box = document.querySelector('#deleted-log');
    box.innerHTML = '<tr><td colspan="4" class="muted">Wczytywanie...</td></tr>';
  
    try {
      const log = await api('/api/control/deleted');
      if (!log.length) {
        box.innerHTML = '<tr><td colspan="4" class="muted">Brak usunięć</td></tr>';
        return;
      }
  
      box.innerHTML = '';
      for (const l of log) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${
            l.deleted_date
              ? new Date(l.deleted_date).toLocaleDateString('pl-PL')
              : '—'
          }</td>
          <td>${l.user_name || '—'}</td>
          <td>${l.reason || '—'}</td>
          <td><a href="#" class="link" data-id="${l.event_id}">#${l.event_id}</a></td>
        `;
        tr.querySelector('a').addEventListener('click', e => {
          e.preventDefault();
          showDeletedDetails(l.event_id);
        });
        box.appendChild(tr);
      }
    } catch (e) {
      box.innerHTML = `<tr><td colspan="4" class="muted">Błąd: ${e.message}</td></tr>`;
    }
  }



  
})();
