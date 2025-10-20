(function initControl() {
  'use strict';

  // Проверяем страницу
  if (!document.body.classList.contains('page-control')) return;
  if (typeof window.initMenu === 'function') window.initMenu();

  const content = document.getElementById('control-content');
  if (!content) return;

  // === Утилиты ===
  const $ = s => document.querySelector(s);
  const el = (tag, cls) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  };
  const toast = window.toast || { success: alert, error: alert, info: alert };

  let USERS = [];
  let STATE = { ym: new Date() };

  const ymStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const api = async (path, opts = {}) => await window.api(path, opts);

  // === Загрузка пользователей ===
  async function loadUsers() {
    try {
      USERS = await api('/api/users');
    } catch {
      USERS = [];
    }
  }

  function fillUsers(select) {
    select.innerHTML = USERS.map(u => `<option value="${u.id}">${u.full_name}</option>`).join('');
  }

  function buildDaysSelect(select) {
    const y = STATE.ym.getFullYear(), m = STATE.ym.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    select.innerHTML = Array.from({ length: days }, (_, i) => {
      const d = i + 1;
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      return `<option value="${iso}">${iso}</option>`;
    }).join('');
  }

  // === Модалки ===
  function openModal(tplId) {
    const tpl = document.getElementById(tplId);
    if (!tpl) throw new Error('Template not found: ' + tplId);

    const backdrop = el('div', 'modal-backdrop');
    const modal = el('div', 'modal');
    modal.appendChild(tpl.content.cloneNode(true));
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();

    backdrop.addEventListener('click', e => {
      if (e.target === backdrop || e.target.classList.contains('modal-close')) close();
    });

    return { modal, close };
  }

  // === Обработчики событий ===

  async function handleLate() {
    const { modal, close } = openModal('tpl-late');
    const u = modal.querySelector('#late-user');
    const d = modal.querySelector('#late-date');
    fillUsers(u); buildDaysSelect(d);

    modal.querySelector('#late-save').addEventListener('click', async () => {
      try {
        await api('/api/control/late', {
          method: 'POST',
          body: JSON.stringify({
            user_id: Number(u.value),
            date: d.value,
            reason: modal.querySelector('#late-reason').value || '',
            delay_minutes: parseInt(modal.querySelector('#late-minutes').value || '0'),
            time_from: modal.querySelector('#late-from').value,
            time_to: modal.querySelector('#late-to').value
          })
        });
        toast.success('Zapisano spóźnienie');
        close();
        await renderSummary();
      } catch (e) {
        toast.error(e.message || 'Błąd');
      }
    });
  }

  async function handleExtra() {
    const { modal, close } = openModal('tpl-extra');
    const u = modal.querySelector('#extra-user');
    const d = modal.querySelector('#extra-date');
    fillUsers(u); buildDaysSelect(d);

    modal.querySelector('#extra-save').addEventListener('click', async () => {
      const hours = parseFloat(modal.querySelector('#extra-hours').value || '0');
      if (!(hours > 0)) return toast.error('Podaj ilość godzin');
      try {
        await api('/api/control/extra', {
          method: 'POST',
          body: JSON.stringify({
            user_id: Number(u.value),
            date: d.value,
            reason: modal.querySelector('#extra-reason').value || '',
            hours
          })
        });
        toast.success('Zapisano dodatkowe godziny');
        close();
        await renderSummary();
      } catch (e) {
        toast.error(e.message || 'Błąd');
      }
    });
  }

  async function handleAbsence() {
    const { modal, close } = openModal('tpl-absence');
    const u = modal.querySelector('#abs-user');
    const d = modal.querySelector('#abs-date');
    fillUsers(u); buildDaysSelect(d);

    modal.querySelector('#abs-save').addEventListener('click', async () => {
      try {
        await api('/api/control/absence', {
          method: 'POST',
          body: JSON.stringify({
            user_id: Number(u.value),
            date: d.value,
            reason: modal.querySelector('#abs-reason').value || ''
          })
        });
        toast.success('Zapisano nieobecność');
        close();
        await renderSummary();
      } catch (e) {
        toast.error(e.message || 'Błąd');
      }
    });
  }

  async function handleShift() {
    const { modal, close } = openModal('tpl-shift');
    const u = modal.querySelector('#sh-user');
    const d = modal.querySelector('#sh-date');
    fillUsers(u); buildDaysSelect(d);

    modal.querySelector('#sh-save').addEventListener('click', async () => {
      const from = modal.querySelector('#sh-from').value;
      const to = modal.querySelector('#sh-to').value;
      if (!from || !to) return toast.error('Podaj godziny');
      try {
        await api('/api/control/add-shift', {
          method: 'POST',
          body: JSON.stringify({
            user_id: Number(u.value),
            date: d.value,
            reason: modal.querySelector('#sh-reason').value || '',
            from, to
          })
        });
        toast.success('Dodano zmianę');
        close();
        await renderSummary();
      } catch (e) {
        toast.error(e.message || 'Błąd');
      }
    });
  }

  function handleDelete(eventId) {
    const { modal, close } = openModal('tpl-delete');
    modal.querySelector('#confirm-delete').addEventListener('click', async (ev) => {
      ev.preventDefault();
      const reason = modal.querySelector('#delete-reason').value.trim();
      if (!reason) return toast.error('Podaj powód!');
      try {
        await api('/api/control/delete', {
          method: 'POST',
          body: JSON.stringify({ id: eventId, reason })
        });
        toast.success('Zdarzenie usunięte');
        close();
        await renderSummary();
      } catch (e) {
          console.warn('delete failed', e);
        }

    });
  }

  // === Основной рендер ===
  async function renderSummary() {
    const box = content;
    box.innerHTML = `
      <div class="row between center" style="margin-bottom:10px;">
        <div id="month-title" class="muted"></div>
        <div class="row" style="gap:6px">
          <button class="btn-secondary" id="ctl-prev">◀</button>
          <button class="btn-secondary" id="ctl-next">▶</button>
        </div>
      </div>
      <div class="card" style="padding:12px">
        <h3>Skrót zdarzeń</h3>
        <div id="events-list"></div>
      </div>
      <div class="card" style="padding:12px; margin-top:12px">
        <h3>Obsada (norma 12)</h3>
        <div id="staffing-table"></div>
      </div>
    `;

    const title = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' }).format(STATE.ym);
    $('#month-title').textContent = title.charAt(0).toUpperCase() + title.slice(1);

    $('#ctl-prev').onclick = () => {
      STATE.ym = new Date(STATE.ym.getFullYear(), STATE.ym.getMonth() - 1, 1);
      renderSummary();
    };
    $('#ctl-next').onclick = () => {
      STATE.ym = new Date(STATE.ym.getFullYear(), STATE.ym.getMonth() + 1, 1);
      renderSummary();
    };

    let data;
    try {
      data = await api(`/api/control/summary?month=${encodeURIComponent(ymStr(STATE.ym))}`);
    } catch (e) {
      $('#events-list').innerHTML = `<div class="muted">${e.message || 'Błąd'}</div>`;
      return;
    }

    const evWrap = $('#events-list');
    const mapName = { late: 'Spóźnienie', extra: 'Dodatkowe godziny', absence: 'Nieobecność', manual_shift: 'Dodana zmiana' };

    if (!data.events?.length) {
      evWrap.innerHTML = '<div class="muted">Brak zdarzeń.</div>';
    } else {
      const list = el('div', 'col');
      data.events.forEach(e => {
        const row = el('div', 'row between');
        row.classList.add('event-row');
        row.innerHTML = `
          <div>
            <span class="tag tag-small">${mapName[e.kind] || e.kind}</span>
            <b>${e.user}</b> — ${e.date}
            ${e.hours ? ` · ${e.hours}h` : ''}
            ${e.time_from ? ` · ${e.time_from}-${e.time_to}` : ''}
            ${e.delay_minutes ? ` · spóźnienie ${e.delay_minutes} min` : ''}
          </div>
          <div class="row center" style="gap:6px;">
            <small class="muted">${e.reason || ''}</small>
            <button class="icon-btn" title="Usuń" data-id="${e.id}">🗑️</button>
          </div>
        `;
        row.querySelector('button').onclick = () => handleDelete(e.id);
        list.appendChild(row);
      });
      evWrap.appendChild(list);
    }

    // staffing
    const st = $('#staffing-table');
    const tbl = el('table', 'table');
    tbl.innerHTML = `
      <thead><tr><th>Data</th><th>Rano</th><th>Δ</th><th>Popo</th><th>Δ</th></tr></thead>
      <tbody></tbody>`;
    const tb = tbl.querySelector('tbody');

    (data.staffing || []).forEach(r => {
      const tr = document.createElement('tr');
      const cls = v => v < 0 ? 'neg' : v > 0 ? 'pos' : '';
      tr.innerHTML = `
        <td>${r.date}</td>
        <td>${r.morning}</td><td class="${cls(r.morning_delta)}">${r.morning_delta}</td>
        <td>${r.evening}</td><td class="${cls(r.evening_delta)}">${r.evening_delta}</td>
      `;
      tb.appendChild(tr);
    });
    st.appendChild(tbl);

    // Deleted log
    const logBox = el('div', 'card');
    logBox.style.marginTop = '12px';
    logBox.innerHTML = `<h3>Usunięte zdarzenia</h3><div id="deleted-log"></div>`;
    box.appendChild(logBox);

    try {
      const log = await api('/api/control/deleted');
      const wrap = logBox.querySelector('#deleted-log');
      if (!log.length) wrap.innerHTML = '<div class="muted">Brak usunięć</div>';
      else wrap.innerHTML = log.map(
        l => `<div class="small muted">${l.deleted_at} — ${l.user_name} usunął zdarzenie #${l.event_id}: ${l.reason}</div>`
      ).join('');
    } catch (e) {
      console.warn('No log:', e);
    }
  }

  // === Привязка кнопок ===
  $('#btn-late')?.addEventListener('click', handleLate);
  $('#btn-extra')?.addEventListener('click', handleExtra);
  $('#btn-absence')?.addEventListener('click', handleAbsence);
  $('#btn-shift')?.addEventListener('click', handleShift);

  // === Инициализация ===
  (async () => {
    await loadUsers();
    await renderSummary();
  })();

})();
