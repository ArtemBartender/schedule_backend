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

  try { if (typeof window.initMenu === 'function') window.initMenu(); } catch(_){}
  const adminLink = document.getElementById('menu-admin');
  if (adminLink) adminLink.hidden = false;

  // ===== Month/Year selects (две пары: для XLSX и для текста) =====
  (function buildMonthYear(){
    const now  = new Date();
    const curM = now.getMonth() + 1;
    const curY = now.getFullYear();

    const monthIds = ['month-select', 'month-select-text'];
    const yearIds  = ['year-select', 'year-select-text'];

    monthIds.forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      sel.innerHTML = '';
      for (let m=1; m<=12; m++){
        const opt = document.createElement('option');
        opt.value = String(m);
        opt.textContent = m.toString().padStart(2,'0');
        if (m === curM) opt.selected = true;
        sel.appendChild(opt);
      }
    });

    yearIds.forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      sel.innerHTML = '';
      for (let y=curY-1; y<=curY+1; y++){
        const opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = String(y);
        if (y === curY) opt.selected = true;
        sel.appendChild(opt);
      }
    });
  })();

  // ===== Logout =====
  document.getElementById('logout-btn')?.addEventListener('click', ()=>{
    try { if (typeof window.clearToken === 'function') window.clearToken(); } catch(_){}
    localStorage.removeItem('access_token');
    sessionStorage.removeItem('access_token');
    window.location.href = '/';
  });

  // ===== XLSX upload =====
  const uploadForm = document.getElementById('upload-form');
  uploadForm?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const btn = uploadForm.querySelector('button[type="submit"]');
    const msg = document.getElementById('upload-msg');

    const month = Number(document.getElementById('month-select')?.value || 0);
    const year  = Number(document.getElementById('year-select')?.value  || 0);

    msg.textContent = '';
    btn.disabled = true;

    try{
      if (!(month>=1 && month<=12) || !(year>=2000 && year<=2100)){
        msg.textContent = 'Wybierz prawidłowy miesiąc i rok.';
        return;
      }
      const fd = new FormData(uploadForm);           // берём файл .xlsx
      fd.append('month', String(month));
      fd.append('year',  String(year));

      const res = await fetch('/api/upload-xlsx', {  // <-- ЭТОТ ЭНДПОИНТ на бэке
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: fd
      });

      const data = await res.json().catch(()=> ({}));
      if (!res.ok) throw data;

      msg.textContent = `Zaimportowano: ${data.imported}` +
        (Array.isArray(data.created_users) ? `, nowych użytkowników: ${data.created_users.length}` : '');

    }catch(err){
      msg.textContent = err?.error || err?.message || 'Błąd importu XLSX';
    }finally{
      btn.disabled = false;
    }
  });

  // ===== Import z tekstu (fallback) =====
  const pasteForm = document.getElementById('paste-form');
  pasteForm?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const btn = pasteForm.querySelector('button[type="submit"]');
    const msg = document.getElementById('paste-msg');

    const text  = (pasteForm.text?.value || '').trim();
    const month = Number(document.getElementById('month-select-text')?.value || 0);
    const year  = Number(document.getElementById('year-select-text')?.value  || 0);

    if (!text){ msg.textContent = 'Wklej tekst.'; return; }
    if (!(month>=1 && month<=12) || !(year>=2000 && year<=2100)){
      msg.textContent = 'Wybierz miesiąc i rok.'; return;
    }

    btn.disabled = true;
    msg.textContent = '';

    try{
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
      msg.textContent = err?.error || err?.message || 'Błąd importu tekstu';
    }finally{
      btn.disabled = false;
    }
  });
})();
