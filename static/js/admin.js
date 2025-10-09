// static/js/admin.js
(function initAdmin(){
  'use strict';
  if (!document.body.classList.contains('page-admin')) return;

  // ===== helpers =====
  function rawToken(){
    try { if (typeof window.getToken === 'function') return window.getToken(); } catch(_){}
    return localStorage.getItem('access_token') || sessionStorage.getItem('access_token') || '';
  }
  function parseJwt(t){
    try{
      const p   = t.split('.')[1];
      const b64 = p.replace(/-/g,'+').replace(/_/g,'/');
      const json= atob(b64);
      const s   = decodeURIComponent(json.split('').map(c => '%' + ('00'+c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      return JSON.parse(s);
    }catch(_){ return null; }
  }

  const token  = rawToken();
  const claims = token ? parseJwt(token) : null;
  const role   = String(claims?.role || '').toLowerCase();

  if (!token) { window.location.replace('/'); return; }
  if (role !== 'admin') { window.location.replace('/dashboard'); return; }

  const adminLink = document.getElementById('menu-admin');
  if (adminLink) adminLink.hidden = false;

  // ===== top menu (optional) =====
  try { if (typeof window.initMenu === 'function') window.initMenu(); } catch(_){}

  // ===== Month/Year selects (shared) =====
  (function buildMonthYear(){
    const monthSel = document.getElementById('month-select');
    const yearSel  = document.getElementById('year-select');
    if (!monthSel || !yearSel) return;

    const now  = new Date();
    const curM = now.getMonth() + 1;
    const curY = now.getFullYear();

    monthSel.innerHTML = '';
    for (let m=1; m<=12; m++){
      const opt = document.createElement('option');
      opt.value = String(m);
      opt.textContent = m.toString().padStart(2,'0');
      if (m === curM) opt.selected = true;
      monthSel.appendChild(opt);
    }

    yearSel.innerHTML = '';
    for (let y=curY-1; y<=curY+1; y++){
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      if (y === curY) opt.selected = true;
      yearSel.appendChild(opt);
    }
  })();

  // ===== Logout =====
  document.getElementById('logout-btn')?.addEventListener('click', ()=>{
    try { if (typeof window.clearToken === 'function') window.clearToken(); } catch(_){}
    localStorage.removeItem('access_token');
    sessionStorage.removeItem('access_token');
    window.location.href = '/';
  });

  // ===== PDF upload (classic / advanced) =====
  const uploadForm = document.getElementById('upload-form');
  uploadForm?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const btn = uploadForm.querySelector('button[type="submit"]');
    const msg = document.getElementById('upload-msg');
    const useAdv = document.getElementById('use-advanced')?.checked;

    const month = Number(document.getElementById('month-select')?.value || 0);
    const year  = Number(document.getElementById('year-select')?.value  || 0);

    btn.disabled = true;
    msg.textContent = '';

    try{
      const fd = new FormData(uploadForm); // <-- ВАЖНО: собрать файл

      let url = '/api/upload-pdf';
      if (useAdv){
        if (!(month>=1 && month<=12) || !(year>=2000 && year<=2100)){
          msg.textContent = 'Wybierz prawidłowy miesiąc i rok.';
          return;
        }
        fd.append('month', String(month));
        fd.append('year',  String(year));
        url = '/api/upload-pdf-adv';
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: fd
      });

      const data = await res.json().catch(()=> ({}));
      if (!res.ok) throw data;

      msg.textContent = `Zaimportowano: ${data.imported}` +
        (Array.isArray(data.created_users) ? `, nowych użytkowników: ${data.created_users.length}` : '');

    }catch(err){
      msg.textContent = err?.error || err?.message || 'Błąd importu';
    }finally{
      btn.disabled = false;
    }
  });

  // ===== Paste text import =====
  const pasteForm = document.getElementById('paste-form');
  pasteForm?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const btn = pasteForm.querySelector('button[type="submit"]');
    const msg = document.getElementById('paste-msg');

    const text  = (pasteForm.text?.value || '').trim();
    const month = Number(document.getElementById('month-select')?.value || 0);
    const year  = Number(document.getElementById('year-select')?.value  || 0);

    if (!text){ msg.textContent = 'Wklej tekst.'; return; }
    if (!(month>=1 && month<=12) || !(year>=2000 && year<=2100)){
      msg.textContent = 'Wybierz miesiąc i rok.'; return;
    }

    btn.disabled = true;
    msg.textContent = '';

    try{
      // Если у тебя есть window.api — можно через него
      if (typeof window.api === 'function'){
        const data = await window.api('/api/upload-text', {
          method: 'POST',
          body: JSON.stringify({ text, month, year })
        });
        msg.textContent = `Zaimportowano: ${data.imported}` +
          (Array.isArray(data.created_users) ? `, nowych użytkowników: ${data.created_users.length}` : '');
      } else {
        const res = await fetch('/api/upload-text', {
          method: 'POST',
          headers: {
            'Content-Type':'application/json',
            'Authorization':'Bearer ' + token
          },
          body: JSON.stringify({ text, month, year })
        });
        const data = await res.json().catch(()=> ({}));
        if (!res.ok) throw data;

        msg.textContent = `Zaimportowano: ${data.imported}` +
          (Array.isArray(data.created_users) ? `, nowych użytkowników: ${data.created_users.length}` : '');
      }
    }catch(err){
      msg.textContent = err?.error || err?.message || 'Błąd importu';
    }finally{
      btn.disabled = false;
    }
  });
})();
