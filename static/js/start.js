// static/js/start.js
(function(){
  const $ = sel => document.querySelector(sel);
  if (typeof initMenu === 'function') try { initMenu(); } catch(_) {}

  // --- helpers ---
  function isoToday(){ return new Date().toISOString().slice(0,10); }
  async function call(url, opts){
    // используем api() если есть (с ретраями), иначе fetch
    if (typeof window.api === 'function') return await window.api(url, opts);
    const res = await fetch(url, Object.assign({ cache:'no-store' }, opts||{}));
    const ct = (res.headers.get('content-type')||'');
    const body = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((body && body.error) ? body.error : `Błąd ${res.status}`);
    return body;
  }

  // --- next shift ---
  function renderNext(data){
    const box = $('#next-shift-box'); if (!box) return;
    const openBtn = $('#open-day');

    if (!data || data.empty){
      box.innerHTML = '<div class="muted">Brak nadchodzącej zmiany</div>';
      openBtn.disabled = true;
      return;
    }

    const d = new Date(data.date);
    const dow = d.toLocaleDateString('pl-PL', { weekday:'long' });
    const dateStr = d.toLocaleDateString('pl-PL', { day:'2-digit', month:'2-digit', year:'numeric' });

    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="font-size:26px;font-weight:800;">${dow[0].toUpperCase()+dow.slice(1)}</div>
        <span class="badge badge-code">${data.code || '—'}</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
        <span class="badge badge-date">${dateStr}</span>
        <span class="badge">Godz.: ${data.hours ?? '-'}</span>
        <span class="badge">Miesiąc: ${data.month_done}/${data.month_total}</span>
      </div>
    `;
    openBtn.disabled = false;
    openBtn.onclick = () => { window.location.href = '/dashboard'; };
  }

  async function loadNext(){
    const box = $('#next-shift-box');
    if (box) box.textContent = 'Ładowanie…';
    try{
      const data = await call('/api/next-shift');
      renderNext(data);
    }catch(e){
      if (box) box.innerHTML = `<span class="muted">Błąd ładowania. Spróbuj ponownie.</span>`;
    }
  }

  // --- notes ---
  async function loadNotes(){
    const d = $('#notes-date')?.value; const list = $('#notes-list');
    if (!d || !list) return;
    list.innerHTML = '<div class="muted">Ładowanie…</div>';
    try{
      const items = await call('/api/day-notes?date=' + d);
      if (!items || !items.length){
        list.innerHTML = '<div class="muted">Brak notatek</div>';
        return;
      }
      list.innerHTML = '<ul style="margin:0;padding-left:18px;">' +
        items.map(n => `<li>${n.text} <span class="muted">(${n.author || ''} ${n.note_date || ''})</span></li>`).join('') +
      '</ul>';
    }catch(e){
      list.innerHTML = `<div class="muted">${e.message || 'Błąd ładowania notatek'}</div>`;
    }
  }

  async function addNote(){
    const d = $('#notes-date')?.value; const input = $('#note-input');
    if (!d || !input) return;
    const txt = (input.value||'').trim(); if (!txt) return;
    try{
      await call('/api/day-notes', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ date: d, text: txt })
      });
      input.value = '';
      loadNotes();
    }catch(e){
      alert(e.message || 'Błąd zapisu notatki');
    }
  }

  // --- init ---
  document.addEventListener('DOMContentLoaded', () => {
    // показать форму добавления заметки для admin/coordinator, если доступна роль
    try{
      const claimsRole = (typeof getRole === 'function') ? getRole() : null;
      if (claimsRole && /admin|coordinator/i.test(claimsRole)) {
        $('#add-note-wrap')?.removeAttribute('hidden');
      }
    }catch(_){ /* ignore */ }

    // дата по умолчанию и события
    const di = $('#notes-date');
    if (di){ di.value = isoToday(); di.addEventListener('change', loadNotes); }

    $('#note-add')?.addEventListener('click', addNote);
    $('#btn-reload-next')?.addEventListener('click', loadNext);
    $('#btn-reload-notes')?.addEventListener('click', loadNotes);

    // загрузки
    loadNext();
    loadNotes();
  });
})();
