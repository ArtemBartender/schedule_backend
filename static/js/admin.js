// admin.js — логика админ-панели

(function initAdmin(){
  if (!document.body.classList.contains('page-admin')) return;

  // Защита страницы: должен быть токен и роль admin
  const token = window.getToken && getToken();
  if (!token) { window.location.replace('/'); return; }
  const claims = window.currentClaims ? currentClaims() : {};
  if (claims.role !== 'admin') { window.location.replace('/dashboard'); return; }

  // Выйти
  const logout = document.getElementById('logout-btn');
  logout?.addEventListener('click', () => { window.clearToken && clearToken(); window.location.href = '/'; });

  // Загрузка PDF
  const uploadForm = document.getElementById('upload-form');
  uploadForm?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const btn = uploadForm.querySelector('button[type="submit"]');
    const msg = document.getElementById('upload-msg');
    btn.disabled = true; msg.textContent = '';
    try{
      const fd = new FormData(uploadForm);
      const res = await fetch('/api/upload-pdf', {
        method:'POST',
        headers:{ 'Authorization':'Bearer '+getToken() },
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw data;
      msg.textContent = `Импортировано смен: ${data.imported}` + (data.created_users?.length ? `, создано пользователей: ${data.created_users.length}` : '');
    }catch(err){
      msg.textContent = (err && err.error) ? err.error : 'Ошибка загрузки PDF';
    }finally{
      btn.disabled = false;
    }
  });

  // Импорт из текста
  const pasteForm = document.getElementById('paste-form');
  pasteForm?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const btn = pasteForm.querySelector('button[type="submit"]');
    const msg = document.getElementById('paste-msg');
    const text = (pasteForm.text.value || '').trim();
    if (!text){ msg.textContent = 'Вставьте текст'; return; }
    btn.disabled = true; msg.textContent = '';
    try{
      const data = await window.api('/api/upload-text', { method:'POST', body: JSON.stringify({ text }) });
      msg.textContent = `Импортировано смен: ${data.imported}` + (data.created_users?.length ? `, создано пользователей: ${data.created_users.length}` : '');
    }catch(err){
      msg.textContent = (err && err.error) ? err.error : 'Ошибка импорта текста';
    }finally{
      btn.disabled = false;
    }
  });
})();
