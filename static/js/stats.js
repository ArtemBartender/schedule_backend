// static/js/stats.js
(function initStats(){
  'use strict';
  if (!document.body.classList.contains('page-stats')) return;

  // ---------- utils ----------
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

    const res = await fetch(url, Object.assign({ cache:'no-store', headers }, opts||{}));
    const ct  = res.headers.get('content-type')||'';
    const body= ct.includes('application/json') ? await res.json().catch(()=>({})) : await res.text().catch(()=> '');
    if (!res.ok){ const err=new Error(body?.error || ('Błąd '+res.status)); err.status=res.status; throw err; }
    return body;
  }

  // ---------- найти KPI блок по заголовку ----------
  function findKpiByTitle(startsWith){
    // 1) по id (старые версии)
    const idsMap = {
      'Przepracowano':   '#worked-hours',
      'Zostało':         '#left-hours',
      'Wynagrodzenie (netto, wykonane)': '#pay-done',
      'Wynagrodzenie (netto, cały zakres)': '#pay-all'
    };
    const idSel = idsMap[startsWith];
    if (idSel && $(idSel)) return { valueEl: $(idSel) };

    // 2) по структуре .kpi -> .kpi-title + .kpi-value
    const cards = $$('.kpi');
    for (const card of cards){
      const title = $('.kpi-title', card);
      const value = $('.kpi-value', card);
      if (title && value && title.textContent.trim().startsWith(startsWith)) {
        return { card, titleEl:title, valueEl:value };
      }
    }
    // 3) fallback: ищем любой блок где встречается такой текст
    const titles = $$('*');
    for (const n of titles){
      if (!n.textContent) continue;
      if (n.textContent.trim().startsWith(startsWith)) {
        // попробуем найти value рядом
        const parent = n.closest('.kpi') || n.parentElement;
        const val = parent?.querySelector('.kpi-value') || parent?.querySelector('.value') || parent?.querySelector('b, strong, span:last-child');
        if (val) return { card: parent, titleEl: n, valueEl: val };
      }
    }
    return { valueEl: null };
  }

  // ---------- найти контейнер для графика ----------
  function findBarsContainer(){
    // 1) по id
    if ($('#hours-chart')) return $('#hours-chart');
    // 2) по классу .bars
    if ($('.bars')) return $('.bars');
    // 3) по заголовку "Godziny wg dni"
    const maybeTitles = $$('*');
    for (const el of maybeTitles){
      if ((el.textContent||'').trim().toLowerCase() === 'godziny wg dni'){
        // обычно следующая секция содержит .bars
        const next = el.closest('.card') || el.parentElement;
        const bars = next?.querySelector('.bars') || next?.nextElementSibling?.querySelector?.('.bars');
        if (bars) return bars;
      }
    }
    // 4) создадим сами внизу страницы, чтобы хоть что-то показать
    const dyn = document.createElement('div');
    dyn.className = 'bars';
    dyn.style.cssText = 'display:flex;align-items:flex-end;gap:6px;height:140px;margin-top:12px';
    document.body.appendChild(dyn);
    return dyn;
  }

  // ---------- навигация месяца ----------
  const now = new Date();
  let year  = now.getFullYear();
  let month = now.getMonth() + 1;

  function setMonthTitle(){
    const mTitle = $('#month-title') || document.querySelector('h1,h2,h3');
    if (mTitle) {
      const label = new Intl.DateTimeFormat('pl-PL', {month:'long', year:'numeric'}).format(new Date(year, month-1, 1));
      mTitle.textContent = label.charAt(0).toUpperCase() + label.slice(1);
    }
  }

  function hookNav(){
    // поддержка старых id
    const btnPrev = $('#btn-prev') || document.querySelector('.month-prev, .btn-prev, [data-prev]');
    const btnNext = $('#btn-next') || document.querySelector('.month-next, .btn-next, [data-next]');

    function tryAttach(el, fn){
      if (!el) return false;
      el.addEventListener('click', fn);
      return true;
    }

    let attached = false;
    attached = tryAttach(btnPrev, ()=>{ month--; if(month<1){month=12;year--;} loadMonth(); }) || attached;
    attached = tryAttach(btnNext, ()=>{ month++; if(month>12){month=1;year++;} loadMonth(); }) || attached;

    if (!attached){
      // fallback: ищем любые две кнопки со стрелками рядом с заголовком
      const container = ($('#month-title')?.parentElement) || document;
      const candidates = Array.from(container.querySelectorAll('button, .icon-btn'));
      const prev = candidates.find(b => /[<‹«]/.test(b.textContent||''));
      const next = candidates.find(b => /[>›»]/.test(b.textContent||''));
      if (prev) prev.addEventListener('click', ()=>{ month--; if(month<1){month=12;year--;} loadMonth(); });
      if (next) next.addEventListener('click', ()=>{ month++; if(month>12){month=1;year++;} loadMonth(); });
    }
  }

  // ---------- настройки (ставка / налог) ----------
  function grabSettingsInputs(){
    const rate = $('#rate') || Array.from($$('input')).find(i => /stawka/i.test(i?.closest('label')?.textContent||'') || /pln\/h|stawka/i.test(i.placeholder||''));
    const tax  = $('#tax')  || Array.from($$('input')).find(i => /podatek/i.test(i?.closest('label')?.textContent||'') || /podatek|%/i.test(i.placeholder||''));
    const save = $('#save-settings') || Array.from($$('button')).find(b => /zapisz/i.test(b.textContent||''));
    return { rateInput: rate, taxInput: tax, saveBtn: save };
  }

  function getSettings(){
    const { rateInput, taxInput } = grabSettingsInputs();
    const rate = parseFloat(rateInput?.value || localStorage.getItem('rate') || 28);
    const tax  = parseFloat(taxInput?.value  || localStorage.getItem('tax')  || 12);
    // если нашли поля в DOM — синхронизируем значения с локалстораджем
    if (rateInput) rateInput.value = String(rate);
    if (taxInput)  taxInput.value  = String(tax);
    return { rate, tax };
  }

  function hookSave(){
    const { rateInput, taxInput, saveBtn } = grabSettingsInputs();
    if (!saveBtn) return;
    saveBtn.addEventListener('click', ()=>{
      if (rateInput) localStorage.setItem('rate', rateInput.value);
      if (taxInput)  localStorage.setItem('tax',  taxInput.value);
      loadMonth();
    });
  }

  // ---------- рендер ----------
  const barsEl = findBarsContainer();

  function setValueFor(label, text){
    const kpi = findKpiByTitle(label);
    if (kpi.valueEl) kpi.valueEl.textContent = text;
  }

  function renderBars(dayStats){
    if (!barsEl) return;
    barsEl.innerHTML = '';
    if (!dayStats.length){
      const p = document.createElement('div');
      p.className = 'muted';
      p.textContent = 'Brak danych.';
      barsEl.appendChild(p);
      return;
    }
    const max = Math.max(...dayStats.map(d => d.hours || 0), 1);
    for (const d of dayStats){
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.height = `${(d.hours / max * 100).toFixed(1)}%`;
      bar.dataset.tip = `${d.date}: ${d.hours.toFixed(1)}h`;
      barsEl.appendChild(bar);
    }
  }

  async function loadMonth(){
    try{
      setMonthTitle();

      const data = await api(`/api/month-shifts?year=${year}&month=${month}`);

      const { rate, tax } = getSettings();
      let totalHours = 0;
      const dayStats = [];

      // data: { 'YYYY-MM-DD': { morning:[], evening:[] }, ... }
      for (const [iso, obj] of Object.entries(data)){
        const shifts = [...(obj?.morning||[]), ...(obj?.evening||[])];
        if (!shifts.length) continue;
        const sum = shifts.reduce((acc,s)=> acc + (Number(s.hours)||0), 0);
        totalHours += sum;
        dayStats.push({ date: iso, hours: sum });
      }

      // простая метрика «норма 160ч»
      const NORM = 160;
      const left = Math.max(0, NORM - totalHours);

      const gross = totalHours * rate;         // брутто
      const net   = gross * (1 - tax/100);     // нетто

      setValueFor('Przepracowano', `${totalHours.toFixed(1)} h`);
      setValueFor('Zostało', left ? `${left.toFixed(1)} h` : '0 h');
      setValueFor('Wynagrodzenie (netto, wykonane)', `${net.toFixed(2)} zł`);
      setValueFor('Wynagrodzenie (netto, cały zakres)', `${gross.toFixed(2)} zł`);

      renderBars(dayStats);
    }catch(e){
      // если что-то пошло не так — покажем прочерки
      setValueFor('Przepracowano', '—');
      setValueFor('Zostało', '—');
      setValueFor('Wynagrodzenie (netto, wykonane)', '—');
      setValueFor('Wynagrodzenie (netto, cały zakres)', '—');
      if (barsEl) barsEl.innerHTML = '';
      console.error(e);
    }
  }

  // init
  hookNav();
  hookSave();
  loadMonth();
})();
