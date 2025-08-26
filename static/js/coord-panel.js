(function initCoordPanel() {
  if (!document.body.classList.contains('page-coord-panel')) return;
  if (typeof initMenu === 'function') initMenu();

  const $ = id => document.getElementById(id);
  const loungeSel   = $('lounge-select');
  const shiftSel    = $('shift-select');
  const dateSel     = $('date-select');
  const saveBtn     = $('save-btn');

  // стандартные поля для баров
  const barKeys = [
    'bar0', 'bar1', 'bar2', 'bar-elita', 'zmiwak', 'barman'
  ];
  const barLabels = {
    bar0: 'Бар 0', bar1: 'Бар 1', bar2: 'Бар 2',
    'bar-elita': 'Бар Елита', zmiwak: 'Змивак', barman: 'Барман'
  };

  // стандартные поля времени
  const timeKeys = ['arrived', 'left'];

  // инициализация даты сегодня
  dateSel.valueAsDate = new Date();

  function renderBars() {
    const wrap = document.getElementById('bars-form');
    wrap.innerHTML = '';
    barKeys.forEach(k => {
      const row = document.createElement('div');
      row.className = 'settings-inline';
      row.innerHTML = `
        <label>${barLabels[k]}<br>
          <input type="text" data-bar="${k}" placeholder="ФИО">
        </label>
      `;
      wrap.appendChild(row);
    });
  }

  function renderTimes() {
    const wrap = document.getElementById('times-form');
    wrap.innerHTML = '';
    timeKeys.forEach(k => {
      const row = document.createElement('div');
      row.className = 'settings-inline';
      row.innerHTML = `
        <label>${k === 'arrived' ? 'Пришёл' : 'Ушёл'}<br>
          <input type="time" data-time="${k}">
        </label>
      `;
      wrap.appendChild(row);
    });
  }

  async function loadReport() {
    const params = new URLSearchParams({
      lounge: loungeSel.value,
      shift_type: shiftSel.value,
      date: dateSel.value
    });
    const res = await fetch(`/api/coord-panel/report?${params}`);
    const data = await res.json();
    if (data.error) return;

    // заполнить баров
    barKeys.forEach(k => {
      const inp = document.querySelector(`[data-bar="${k}"]`);
      if (inp) inp.value = (data.bars && data.bars[k]) || '';
    });

    // заполнить времена
    timeKeys.forEach(k => {
      const inp = document.querySelector(`[data-time="${k}"]`);
      if (inp) inp.value = (data.times && data.times[k]) || '';
    });

    // заметки
    $('notes-past').value = (data.notes && data.notes.past) || '';
    $('notes-missing').value = (data.notes && data.notes.missing) || '';
    $('notes-passengers').value = (data.notes && data.notes.passengers) || '';
  }

  async function saveReport() {
    const bars = {};
    barKeys.forEach(k => {
      bars[k] = document.querySelector(`[data-bar="${k}"]`).value.trim();
    });
    const times = {};
    timeKeys.forEach(k => {
      times[k] = document.querySelector(`[data-time="${k}"]`).value.trim();
    });
    const notes = {
      past: $('notes-past').value.trim(),
      missing: $('notes-missing').value.trim(),
      passengers: $('notes-passengers').value.trim()
    };

    const payload = {
      lounge: loungeSel.value,
      shift_type: shiftSel.value,
      shift_date: dateSel.value,
      bars, times, notes
    };

    const res = await fetch('/api/coord-panel/report', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    if (res.ok) alert('Сохранено!');
    else alert('Ошибка сохранения');
  }

  [loungeSel, shiftSel, dateSel].forEach(el =>
    el.addEventListener('change', loadReport)
  );
  saveBtn.addEventListener('click', saveReport);

  renderBars();
  renderTimes();
  loadReport();
})();