window.addEventListener('DOMContentLoaded', () => {
  (function(){
    const modal = document.getElementById('reset-modal');
    const openBtn = document.getElementById('forgot-link');
    const closeBtn = document.getElementById('reset-close');
    const sendBtn = document.getElementById('reset-send');
    const oldPass = document.getElementById('old-pass');
    const newPass = document.getElementById('new-pass');
    const newPass2 = document.getElementById('new-pass2'); // подтверждение

    // Меняем текст линка, если надо
    if (openBtn) openBtn.textContent = 'Zmień hasło';

    // API helper
    const api = async (url, opts) => {
      const res = await fetch(url, Object.assign({
        headers: {'Content-Type': 'application/json'}
      }, opts || {}));
      const body = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(body.error || 'Błąd');
      return body;
    };

    // открыть / закрыть модалку
    openBtn?.addEventListener('click', e => {
      e.preventDefault();
      modal.classList.remove('hidden');
      oldPass.value = '';
      newPass.value = '';
      if (newPass2) newPass2.value = '';
    });

    closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));

    // отправить
    sendBtn?.addEventListener('click', async () => {
      const oldP = oldPass.value.trim();
      const newP = newPass.value.trim();
      const newP2 = newPass2 ? newPass2.value.trim() : newP;

      if (!oldP || !newP)
        return alert('Wpisz oba pola hasła.');
      if (newP.length < 6)
        return alert('Nowe hasło musi mieć co najmniej 6 znaków.');
      if (newP !== newP2)
        return alert('Nowe hasła nie są identyczne.');

      try {
        await api('/api/password/change', {
          method: 'POST',
          body: JSON.stringify({
            stare_haslo: oldP,
            nowe_haslo: newP
          })
        });

        // 🎉 успех
        if (window.toast) toast.success('✅ Hasło zostało zmienione pomyślnie.');
        else alert('Hasło zostało zmienione pomyślnie.');

        modal.classList.add('hidden');
        oldPass.value = '';
        newPass.value = '';
        if (newPass2) newPass2.value = '';

      } catch(e) {
        if (window.toast) toast.error(e.message || '❌ Błąd podczas zmiany hasła.');
        else alert(e.message || 'Błąd podczas zmiany hasła.');
      }
    });
  })();
});
