// static/js/stats.js
(function initStats(){
  'use strict';
  if (!document.body.classList.contains('page-stats')) return;

  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"]/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

  // ==== API с токеном и CORS ====
  async function api(url, opts){
    const headers = new Headers((opts && opts.headers) || {});

    // JSON body, если не FormData
    if (opts && opts.body && !(opts.body instanceof FormData) && !headers.has('Content-Type')){
      headers.set('Content-Type','application/json');
    }

    // достаём токен из разных мест
    let t = null;
    try {
      if (typeof window.getToken === 'function') t = window.getToken();
      if (!t) t = localStorage.getItem('access_token') || sessionStorage.getItem('access_token');
    } catch(_) {}

    if (t) headers.set('Authorization','Bearer '+t);
    else console.warn('⚠️ No JWT token found when calling', url);

    const res = await fetch(url, Object.assign({
      cache:'no-store',
      headers,
      credentials:'include', // важно для Render
      mode:'cors'
    }, opts||{}));

    const ct  = res.headers.get('content-type')||'';
    const body= ct.includes('application/json')
      ? await res.json().catch(()=>({}))
      : await res.text().catch(()=> '');

    if (!res.ok){
      const err = new Error(body?.error || ('Błąd '+res.status));
      err.status = res.status;
      console.error('❌ API error', err, url);
      throw err;
    }
    return body;
  }

  // ==== JWT user ====
  function decodeJWT(t){
    try{ const p=t.split('.')[1]; return JSON.parse(atob(p.replace(/-/g,'+').replace(/_/g,'/'))); }
    catch(_){ return {}; }
  }
  function currentUser(){
    let tok = '';
    try {
      tok = localStorage.getItem('access_token') || sessionStorage.getItem('access_token') || '';
      if (typeof window.getToken === 'function' && !tok) tok = window.getToken() || '';
    } catch(_){}
    if (!tok) return {};
    return decodeJWT(tok) || {};
  }
  const me = currentUser();
  const myId = Number(me.sub || me.user_id || 0);
  const myName = me.full_name || '';

  // ==== UI ====
  const now = new Date();
  let year  = now.getFullYear();
  let month = now.getMonth() + 1;

  const elTitle = $('#month-title');
  const elWorked = $('#worked-hours') || $('.kpi-value[data-for="worked"]');
  const elLeft   = $('#left-hours')   || $('.kpi-value[data-for="left"]');
  const elPayDone= $('#pay-done')     || $('.kpi-value[data-for="net-done"]');
  const elPayAll = $('#pay-all')      || $('.kpi-value[data-for="gross-all"]');
  const elChart  = $('#hours-chart')  || $('.bars');

  const rateInput = $('#rate');
  const taxInput  = $('#tax');
  const saveBtn   = $('#save-settings');

  const btnPrev = $('#btn-prev') || document.querySelector('.month-prev');
  const btnNext = $('#btn-next') || document.querySelector('.month-next');

  btnPrev?.addEventListener('click', ()=>{
    month--;
    if(month < 1){ month = 12; year--; }
    loadMonth();
  });
  btnNext?.addEventListener('click', ()=>{
    month++;
    if(month > 12){ month = 1; year++; }
    loadMonth();
  });

  saveBtn?.addEventListener('click', ()=>{
    if (rateInput) localStorage.setItem('rate', rateInput.value);
    if (taxInput)  localStorage.setItem('tax', taxInput.value);
    loadMonth();
  });

  function getSettings(){
    const rate = parseFloat(rateInput?.value || localStorage.getItem('rate') || 28);
    const tax  = parseFloat(taxInput?.value || localStorage.getItem('tax') || 12);
    if (rateInput) rateInput.value = rate;
    if (taxInput)  taxInput.value  = tax;
    return { rate, tax };
  }

  function updateTitle(){
    const label = new Intl.DateTimeFormat('pl-PL', {month:'long', year:'numeric'}).format(new Date(year, month-1, 1));
    if (elTitle) elTitle.textContent = label.charAt(0).toUpperCase() + label.slice(1);
  }

  // ==== rendering ====
  function renderChart(list){
    if (!elChart) return;
    elChart.innerHTML = '';
    if (!list.length){
      elChart.innerHTML = '<div class="muted">Brak danych.</div>';
      return;
    }
    const max = Math.max(...list.map(x => x.hours), 1);
    for (const d of list){
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.height = `${(d.hours/max*100).toFixed(1)}%`;
      bar.title = `${d.date}: ${d.hours.toFixed(1)}h`;
      elChart.appendChild(bar);
    }
  }

  // ==== core ====
  async function loadMonth(){
    try{
      updateTitle();
      const { rate, tax } = getSettings();
      const monthData = await api(`/api/month-shifts?year=${year}&month=${month}`);

      let totalHours = 0;
      const daily = [];

      // фильтруем только мои смены
      for (const [day, block] of Object.entries(monthData)){
        const shifts = [...(block.morning || []), ...(block.evening || [])];
        const myShifts = shifts.filter(s => {
          const uidMatch = s.user_id && myId && Number(s.user_id) === myId;
          const nameMatch = (
            s.full_name &&
            myName &&
            s.full_name.trim().toLowerCase().includes(myName.trim().toLowerCase())
          );
          return uidMatch || nameMatch;
        });

        if (!myShifts.length) continue;
        const hours = myShifts.reduce((a,b)=>a+(Number(b.hours)||0),0);
        totalHours += hours;
        daily.push({ date: day, hours });
      }

      const NORM = 160;
      const left = Math.max(0, NORM - totalHours);
      const gross = totalHours * rate;
      const net   = gross * (1 - tax/100);

      if (elWorked) elWorked.textContent  = `${totalHours.toFixed(1)} h`;
      if (elLeft)   elLeft.textContent    = `${left.toFixed(1)} h`;
      if (elPayDone)elPayDone.textContent = `${net.toFixed(2)} zł`;
      if (elPayAll) elPayAll.textContent  = `${gross.toFixed(2)} zł`;

      renderChart(daily);
    }catch(e){
      console.error('Month load failed:', e);
      if (elWorked) elWorked.textContent = '—';
      if (elLeft)   elLeft.textContent = '—';
      if (elPayDone)elPayDone.textContent = '—';
      if (elPayAll) elPayAll.textContent = '—';
      if (elChart)  elChart.innerHTML = `<div class="muted">Błąd ładowania (${e.message || e})</div>`;
    }
  }

  // init
  loadMonth();
})();

