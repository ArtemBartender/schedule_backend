(function initControl(){
  'use strict';
  if (!document.body.classList.contains('page-control')) return;

  const content = document.getElementById('control-content');
  if (!content) return;

  // initMenu (из app.js)
  if (typeof window.initMenu === 'function') window.initMenu();

  // ---- helpers ----
  const createEl = (tag, cls) => { const e=document.createElement(tag); if(cls)e.className=cls; return e; };
  const modalBackdrop = html => {
    const m = createEl('div','modal-backdrop');
    m.innerHTML = `<div class="modal">${html}</div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e=>{
      if (e.target===m || e.target.classList.contains('modal-close')) m.remove();
    });
  };

  // ---- modal builders ----
  function openLateModal(){
    modalBackdrop(`
      <div class="modal-head">
        <div class="modal-title">Dodaj spóźnienie</div>
        <button class="modal-close">×</button>
      </div>
      <div class="modal-body">
        <label>Pracownik:</label><select id="late-user"></select>
        <label>Dzień:</label><select id="late-date"></select>
        <button class="btn-primary" id="late-save">Zapisz</button>
      </div>
    `);
  }

  function openExtraModal(){
    modalBackdrop(`
      <div class="modal-head">
        <div class="modal-title">Dodaj dodatkowe godziny</div>
        <button class="modal-close">×</button>
      </div>
      <div class="modal-body">
        <label>Pracownik:</label><select id="extra-user"></select>
        <label>Dzień:</label><select id="extra-date"></select>
        <label>Powód:</label><input id="extra-reason" type="text">
        <label>Ilość godzin:</label><input id="extra-hours" type="number" min="1" max="12">
        <button class="btn-primary" id="extra-save">Zapisz</button>
      </div>
    `);
  }

  function openAbsenceModal(){
    modalBackdrop(`
      <div class="modal-head">
        <div class="modal-title">Zgłoś nieobecność</div>
        <button class="modal-close">×</button>
      </div>
      <div class="modal-body">
        <label>Pracownik:</label><select id="abs-user"></select>
        <label>Dzień:</label><select id="abs-date"></select>
        <label>Powód:</label><input id="abs-reason" type="text">
        <button class="btn-primary" id="abs-save">Zapisz</button>
      </div>
    `);
  }

  function openShiftModal(){
    modalBackdrop(`
      <div class="modal-head">
        <div class="modal-title">Dodaj zmianę</div>
        <button class="modal-close">×</button>
      </div>
      <div class="modal-body">
        <label>Pracownik:</label><select id="shift-user"></select>
        <label>Dzień:</label><select id="shift-date"></select>
        <label>Powód:</label><input id="shift-reason" type="text">
        <label>Godziny:</label>
        <div style="display:flex;gap:6px;">
          <input id="shift-from" type="time"> do <input id="shift-to" type="time">
        </div>
        <button class="btn-primary" id="shift-save">Zapisz</button>
      </div>
    `);
  }

  // ---- привязки кнопок ----
  document.getElementById('btn-late')?.addEventListener('click', openLateModal);
  document.getElementById('btn-extra')?.addEventListener('click', openExtraModal);
  document.getElementById('btn-absence')?.addEventListener('click', openAbsenceModal);
  document.getElementById('btn-shift')?.addEventListener('click', openShiftModal);
})();
