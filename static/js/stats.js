(function initStats(){
  'use strict';
  if (!document.body.classList.contains('page-stats')) return;

  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"]/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

  async function api(url, opts){
    const headers = new Headers((opts && opts.headers) || {});
    if (opts && opts.body && !(opts.body instanceof FormData) && !headers.has('Content-Type')){
      headers.set('Content-Type','application/json');
    }
    const t = localStorage.getItem('access_token') || sessionStorage.getItem('access_token');
    if (t) headers.set('Authorization','Bearer '+t);

    const res = await fetch(url, Object.assign({cache:'no-store', headers}, opts||{}));
    const ct = res.headers.get('content-type')||'';
    const body = ct.includes('application/json') ? await res.json().catch(()=>({})) : await res.text().catch(()=> '');
    if (!res.ok){ const err = new Error(body?.error || ('Błąd '+res.status)); err.status=res.status; throw err; }
    return body;
  }

  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;

  const title = $('#month-title');
  const btnPrev = $('#btn-prev');
  const btnNext = $('#btn-next');

  function updateTitle(){
    title.textContent = new Intl.DateTimeFormat('pl-PL', {month:'long', year:'numeric'}).format(new Date(year, month-1, 1));
  }

  btnPrev?.addEventListener('click', ()=>{ month--; if(month<1){month=12;year--;} loadMonth(); });
  btnNext?.addEventListener('click', ()=>{ month++; if(month>12){month=1;year++;} loadMonth(); });

  // поля вывода
  const elWorked     = $('#worked-hours');
  const elLeft       = $('#left-hours');
  const elPayDone    = $('#pay-done');
  const elPayAll     = $('#pay-all');
  const elChart      = $('#hours-chart');

  const rateInput    = $('#rate');
  const taxInput     = $('#tax');
  const saveBtn      = $('#save-settings');

  function getSettings(){
    return {
      rate: parseFloat(rateInput?.value || localStorage.getItem('rate') || 28),
      tax:  parseFloat(taxInput?.value || localStorage.getItem('tax') || 12)
    };
  }

  saveBtn?.addEventListener('click', ()=>{
    localStorage.setItem('rate', rateInput.value);
    localStorage.setItem('tax', taxInput.value);
    loadMonth();
  });

  async function loadMonth(){
    try{
      updateTitle();
      const data = await api(`/api/month-shifts?year=${year}&month=${month}`);
      const {rate, tax} = getSettings();

      let totalHours = 0;
      let workedDays = 0;
      const dayStats = [];

      // проходим по каждому дню
      for (const [iso, obj] of Object.entries(data)){
        const shifts = [...(obj.morning||[]), ...(obj.evening||[])];
        if (!shifts.length) continue;

        const sumH = shifts.reduce((a,b)=>a+(b.hours||0),0);
        totalHours += sumH;
        workedDays++;
        dayStats.push({date: iso, hours: sumH});
      }

      const totalPay = totalHours * rate;
      const net = totalPay * (1 - tax/100);

      // обновление UI
      elWorked.textContent  = `${totalHours.toFixed(1)} h`;
      elLeft.textContent    = workedDays ? `${(160 - totalHours).toFixed(1)} h` : '—';
      elPayDone.textContent = `${net.toFixed(2)} zł`;
      elPayAll.textContent  = `${(totalPay).toFixed(2)} zł`;

      // график по дням
      renderChart(dayStats);
    }catch(e){
      console.error(e);
      elWorked.textContent = elLeft.textContent = elPayDone.textContent = elPayAll.textContent = '—';
    }
  }

  function renderChart(dayStats){
    if (!elChart) return;
    elChart.innerHTML = '';
    if (!dayStats.length){
      elChart.textContent = 'Brak danych.';
      return;
    }

    const max = Math.max(...dayStats.map(d=>d.hours||0), 1);
    for (const d of dayStats){
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.height = `${(d.hours/max*100).toFixed(1)}%`;
      bar.title = `${d.date}: ${d.hours.toFixed(1)}h`;
      elChart.appendChild(bar);
    }
  }

  // init
  loadMonth();
})();
