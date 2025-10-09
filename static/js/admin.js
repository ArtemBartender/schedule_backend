// static/js/admin.js
(function initAdmin(){
  if (!document.body.classList.contains('page-admin')) return;

  // меню
  try { if (typeof window.initMenu === 'function') window.initMenu(); } catch(_) {}

  // --- токен / клеймы ---
  function rawToken(){
    try { if (window.getToken) return window.getToken(); } catch(_) {}
    return localStorage.getItem('access_token') || sessionStorage.getItem('access_token');
  }
  function parseJwt(t){
    try {
      const p = t.split('.')[1];
      const b64 = p.replace(/-/g,'+').replace(/_/g,'/');
      const json = atob(b64);
      const s = decodeURIComponent(json.split('').map(c => '%' + ('00'+c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      return JSON.parse(s);
    } catch(_) { return null; }
  }

  const token  = rawToken();
  const claims = token ? parseJwt(token) : null;
  const role   = String(claims?.role || '').toLowerCase();

  if (!token) { window.location.replace('/'); return; }
  if (role !== 'admin') { window.location.replace('/dashboard'); return; }

  const adminLink = document.getElementById('menu-admin');
  if (adminLink) adminLink.hidden = false;

  // --------- формируем выпадашки Месяц/Год ---------
  (function buildMonthYear(){
    const monthSel = document.getElementById('month-select');
    const yearSel  = document.getElementById('year-select');
    if (!monthSel || !yearSel) return;

    const now = new Date();
    const curM = now.getMonth()+1, curY = now.getFullYear();

    // месяцы 1..12
    monthSel.innerHTML = '';
    for (let m=1; m<=12; m++){
      const opt = document.createElement('option');
      opt.value = String(m);
      opt.textContent = m.toString().padStart(2,'0');
      if (m===curM) opt.selected = true;
      monthSel.appendChild(opt);
    }
    // годы — прошлый, текущий, следующий
    yearSel.innerHTML='';
    for (let y=curY-1; y<=curY+1; y++){
      const opt=document.createElement('option');
      opt.value=String(y); opt.textContent=String(y);
      if (y===curY) opt.selected=true;
      yearSel.appendChild(opt);
    }
  })();

  // выход
  document.getElementById('logout-btn')?.addEventListener('click', ()=>{
    try { if (window.clearToken) window.clearToken(); } catch(_){}
    localStorage.removeItem('access_token');
    sessionStorage.removeItem('access_token');
    window.location.href = '/';
  });

  // -------- Загрузка PDF --------
  const uploadForm = document.getElementById('upload-form');
  uploadForm?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const btn = uploadForm.querySelector('button[type="submit"]');
    const msg = document.getElementById('upload-msg');
    btn.disabled = true; msg.textContent = '';
    try{
      const useAdv = document.getElementById('use-advanced')?.checked;
      const url = useAdv ? '/api/upload-pdf-adv' : '/api/upload-pdf';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization':'Bearer '+token },
        body: fd
      });

      const data = await res.json().catch(()=> ({}));
      if (!res.ok) throw data;
      msg.textContent = `Import: ${data.imported}` + (Array.isArray(data.created_users) ? `, users: ${data.created_users.length}` : '');
    }catch(err){
      msg.textContent = err?.error || err?.message || 'Błąd';
    }finally{
      btn.disabled = false;
    }
  });

  // -------- Импорт из текста --------
  const pasteForm = document.getElementById('paste-form');
  pasteForm?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const btn = pasteForm.querySelector('button[type="submit"]');
    const msg = document.getElementById('paste-msg');
    const text = (pasteForm.text?.value || '').trim();
    const month = Number(document.getElementById('month-select')?.value || 0);
    const year  = Number(document.getElementById('year-select')?.value || 0);
    if (!text){ msg.textContent = 'Wklej tekst'; return; }
    if (!(month>=1 && month<=12) || !(year>=2000 && year<=2100)){
      msg.textContent = 'Wybierz miesiąc i rok'; return;
    }
    btn.disabled = true; msg.textContent = '';
    try{
      // если window.api есть — он добавит Authorization; иначе сами
      if (typeof window.api === 'function'){
        const data = await window.api('/api/upload-text', {
          method:'POST',
          body: JSON.stringify({ text, month, year })
        });
        msg.textContent = `Import: ${data.imported}` + (Array.isArray(data.created_users) ? `, users: ${data.created_users.length}` : '');
      } else {
        const res = await fetch('/api/upload-text', {
          method:'POST',
          headers:{
            'Content-Type':'application/json',
            'Authorization':'Bearer '+token
          },
          body: JSON.stringify({ text, month, year })
        });
        const data = await res.json().catch(()=> ({}));
        if (!res.ok) throw data;
        msg.textContent = `Import: ${data.imported}` + (Array.isArray(data.created_users) ? `, users: ${data.created_users.length}` : '');
      }
    }catch(err){
      // типичные ошибки: 400 с текстом, 401 без заголовка
      msg.textContent = err?.error || err?.message || 'Błąd';
    }finally{
      btn.disabled = false;
    }
  });
})();

