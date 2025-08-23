// Линейный календарь: одна полоса = один день

// Месяцы/дни
const PL_MONTHS = [
  "Styczeń","Luty","Marzec","Kwiecień","Maj","Czerwiec",
  "Lipiec","Sierpień","Wrzesień","Październik","Listopad","Grudzień"
];
const PL_WEEKDAYS_SHORT = ["Nd","Pn","Wt","Śr","Cz","Pt","So"];

const state = { y: 0, m: 0, // current year/month
                byDate: new Map() // "YYYY-MM-DD" -> массив людей со сменами
              };

function daysInMonth(y,m){ return new Date(y, m+1, 0).getDate(); }
function monthTitle(y,m){ return `${PL_MONTHS[m]} ${y}`; }
function iso(y,m,d){ return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }

function roleBadges(p){
  const out = [];
  if (p.is_coordinator) out.push('<span class="badge badge-coord">koord.</span>');
  if (p.is_zmiwaka)     out.push('<span class="badge badge-zmiwaka">zmyw.</span>');
  return out.join('');
}
function chip(p){
  const code = p.shift_code ? `<span class="code">${p.shift_code}</span>` : '';
  return `<span class="chip"><span class="chip-name">${p.full_name || "—"}</span><span class="chip-right">${roleBadges(p)}${code}</span></span>`;
}
function myTag(code){ return `<span class="myshift">Moja zmiana&nbsp;<b>${code || "—"}</b></span>`; }

function buildEmptyMonth(y,m){
  // заголовок
  document.getElementById('month-title').textContent = monthTitle(y,m);

  const list = document.getElementById('days-list');
  list.innerHTML = '';

  const dmax = daysInMonth(y,m);
  for (let d=1; d<=dmax; d++){
    const dt = new Date(y,m,d);
    const wd = dt.getDay(); // 0..6 (Вс..Сб)
    const row = document.createElement('article');
    row.className = 'day-row';
    row.id = `day-${d}`;
    row.setAttribute('data-date', iso(y,m,d));
    row.innerHTML = `
      <div class="day-head">
        <div class="day-num">${d}</div>
        <div class="day-weekday">${PL_WEEKDAYS_SHORT[wd]}</div>
      </div>
      <div class="day-body">
        <div class="myshift-wrap" hidden></div>
        <div class="shift-group">
          <div class="sg-title">Утро</div>
          <div class="sg-list"><span class="muted">—</span></div>
        </div>
        <div class="shift-group">
          <div class="sg-title">Вечер</div>
          <div class="sg-list"><span class="muted">—</span></div>
        </div>
      </div>`;
    list.appendChild(row);
  }
}

function fillMonth(y,m){
  // Вставляем людей/коды в уже построенные пустые дни
  const claims = (window.currentClaims && window.currentClaims()) || {};
  const meName = claims.full_name;

  const dmax = daysInMonth(y,m);
  for (let d=1; d<=dmax; d++){
    const key = iso(y,m,d);
    const row = document.getElementById(`day-${d}`);
    if (!row) continue;

    const items = state.byDate.get(key) || [];

    const morning = items.filter(p => String(p.shift_code||'').toUpperCase().startsWith('1'));
    const evening = items.filter(p => String(p.shift_code||'').toUpperCase().startsWith('2'));
    const my = meName ? items.find(p => p.full_name === meName) : null;

    // моя смена
    const myWrap = row.querySelector('.myshift-wrap');
    if (my){
      myWrap.innerHTML = myTag(my.shift_code);
      myWrap.hidden = false;
    } else {
      myWrap.hidden = true;
      myWrap.innerHTML = '';
    }

    // утро
    const mList = row.querySelectorAll('.sg-list')[0];
    mList.innerHTML = morning.length ? morning.map(chip).join('') : '<span class="muted">—</span>';

    // вечер
    const eList = row.querySelectorAll('.sg-list')[1];
    eList.innerHTML = evening.length ? evening.map(chip).join('') : '<span class="muted">—</span>';
  }
}

async function loadShiftsAndIndex(){
  // api() берём из app.js; если его нет — сделаем простую заглушку (без токена)
  const http = window.api || (async (path,opts={})=>{
    const res = await fetch(path,opts); const ct=res.headers.get('content-type')||'';
    return ct.includes('application/json') ? res.json() : res.text();
  });

  try{
    const data = await http('/api/shifts'); // массив
    const by = new Map();
    for (const s of data){
      const k = s.shift_date;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(s);
    }
    state.byDate = by;
  }catch(err){
    // если 401 — app.js уже отвёл на логин; тут просто оставим пустые дни
    state.byDate = new Map();
  }
}

function changeMonth(delta){
  const d = new Date(state.y, state.m, 1);
  d.setMonth(d.getMonth() + delta);
  state.y = d.getFullYear(); state.m = d.getMonth();
  buildEmptyMonth(state.y, state.m);
  fillMonth(state.y, state.m);
}

async function init(){
  if (!document.body.classList.contains('page-dashboard')) return;

  if (typeof isTokenValid === 'function' && !isTokenValid()){
    // чистим и отправляем на логин
    if (typeof clearToken === 'function') clearToken();
    window.location.replace('/');
    return;
  }

  const now = new Date();
  state.y = now.getFullYear();
  state.m = now.getMonth();

  // 1) Рисуем пустой месяц (чтоб не было чёрного экрана)
  buildEmptyMonth(state.y, state.m);

  // 2) Грузим смены и наполняем
  await loadShiftsAndIndex();
  fillMonth(state.y, state.m);

  // 3) Навигация
  document.getElementById('prev-month').addEventListener('click', ()=> changeMonth(-1));
  document.getElementById('next-month').addEventListener('click', ()=> changeMonth(+1));
}

// безопасный запуск и экспорт на случай поздней загрузки
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
window.__dashboardInit = () => { try { init(); } catch(e){ console.error(e); } };
