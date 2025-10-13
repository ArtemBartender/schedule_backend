(function initControl(){
  'use strict';
  if (!document.body.classList.contains('page-control')) return;

  // menu init
  if (typeof initMenu === 'function') initMenu();

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const select = $('#month-select');
  const now = new Date();

  // === month selector ===
  for (let i=0; i<6; i++){
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = new Intl.DateTimeFormat('pl-PL', {month:'long', year:'numeric'}).format(d);
    const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label.charAt(0).toUpperCase() + label.slice(1);
    if (i===0) opt.selected = true;
    select.appendChild(opt);
  }

  const tabs = $$('.tab-btn');
  tabs.forEach(btn => {
    btn.addEventListener('click', ()=>{
      tabs.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const id = btn.dataset.tab;
      $$('.tab-content').forEach(tc => tc.classList.add('hidden'));
      $('#tab-'+id).classList.remove('hidden');
    });
  });

  // === render helpers ===
  const renderTable = (container, rows, headers) => {
    if (!rows?.length){ container.innerHTML = '<div class="muted">Brak danych</div>'; return; }
    const table = document.createElement('table');
    table.className = 'data-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr>' + headers.map(h=>`<th>${h}</th>`).join('') + '</tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    rows.forEach(r=>{
      const tr = document.createElement('tr');
      headers.forEach(h=>{
        const key = h.toLowerCase();
        const val = r[key] ?? '';
        tr.innerHTML += `<td>${val}</td>`;
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.innerHTML = '';
    container.appendChild(table);
  };

  async function loadControl(){
    const month = select.value;
    const data = await api('/api/admin/control?month='+month);

    $('#kpi-swaps').textContent = data.swaps?.length || 0;
    $('#kpi-missing').textContent = data.missing?.length || 0;
    $('#kpi-extra').textContent = data.extra_hours?.length || 0;
    $('#kpi-imbalance').textContent = data.imbalance?.length || 0;

    // tables
    renderTable($('#tab-swaps'), data.swaps, ['Date', 'From', 'To', 'Shift_from', 'Shift_to']);
    renderTable($('#tab-extra'), data.extra_hours, ['Date', 'User', 'Shift', 'Extra', 'Note']);
    renderTable($('#tab-missing'), data.missing, ['Date', 'User', 'Shift', 'Reason']);
    renderTable($('#tab-imbalance'), data.imbalance, ['Date', 'Rano', 'Popo', 'Status']);
  }

  select.addEventListener('change', loadControl);
  loadControl();
})();
