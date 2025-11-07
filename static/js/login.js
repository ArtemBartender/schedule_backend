window.addEventListener('DOMContentLoaded', () => {
  (function () {
    const modal     = document.getElementById('reset-modal');
    const openBtn   = document.getElementById('forgot-link');
    const closeBtn  = document.getElementById('reset-close');
    const sendBtn   = document.getElementById('reset-send');

    // добавляем новое поле email в модалку (если его нет)
    if (!modal.querySelector('#login-email')) {
      const emailField = document.createElement('div');
      emailField.innerHTML = `
        <label for="login-email">Email</label>
        <input type="email" id="login-email" placeholder="Wpisz email">
      `;
      const firstLabel = modal.querySelector('label');
      modal.querySelector('.modal-content').insertBefore(emailField, firstLabel);
    }

    const emailInput = modal.querySelector('#login-email');
    const oldPass    = modal.querySelector('#old-pass');
    const newPass    = modal.querySelector('#new-pass');
    const newPass2   = document.getElementById('new-pass2'); // если появится подтверждение

    // Если вдруг каких-то элементов нет — просто выходим
    if (!modal || !openBtn || !sendBtn || !oldPass || !newPass) return;

    // меняем текст кнопки/ссылки
    openBtn.textContent = 'Zmień hasło';

    // универсальный fetch helper
    const api = async (url, opts = {}) => {
      const res = await fetch(
        url,
        Object.assign(
          { headers: { 'Content-Type': 'application/json' } },
          opts
        )
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Błąd');
      return body;
    };

    // открыть / закрыть модалку
    openBtn.addEventListener('click', e => {
      e.preventDefault();
      modal.classList.remove('hidden');
      oldPass.value = '';
      newPass.value = '';
      emailInput.value = '';
      if (newPass2) newPass2.value = '';
    });

    closeBtn.addEventListener('click', () => modal.classList.add('hidden'));

    // обработка клика “Zapisz”
    sendBtn.addEventListener('click', async () => {
      const email = emailInput.value.trim().toLowerCase();
      const oldP  = oldPass.value.trim();
      const newP  = newPass.value.trim();
      const newP2 = newPass2 ? newPass2.value.trim() : newP;

      if (!email || !oldP || !newP)
        return alert('Wpisz wszystkie pola.');
      if (newP.length < 6)
        return alert('Nowe hasło musi mieć co najmniej 6 znaków.');
      if (newP !== newP2)
        return alert('Nowe hasła nie są identyczne.');

      try {
        // если пользователь не залогинен — шлём на /change-before-login
        let endpoint = '/api/password/change-before-login';
        let body = { email, stare_haslo: oldP, nowe_haslo: newP };

        // если где-то сохранён токен (в localStorage/sessionStorage) — значит он залогинен
        const token =
          localStorage.getItem('access_token') ||
          sessionStorage.getItem('access_token');
        if (token) {
          endpoint = '/api/password/change-before-login';
          body = { stare_haslo: oldP, nowe_haslo: newP };
        }

        await api(endpoint, {
          method: 'POST',
          body: JSON.stringify(body)
        });

        // 🎉 успех
        if (window.toast) toast.success('✅ Hasło zostało zmienione pomyślnie.');
        else alert('Hasło zostało zmienione pomyślnie.');

        // очищаем и закрываем
        oldPass.value = '';
        newPass.value = '';
        emailInput.value = '';
        if (newPass2) newPass2.value = '';
        setTimeout(() => modal.classList.add('hidden'), 700);

      } catch (e) {
        if (window.toast) toast.error(e.message || '❌ Błąd podczas zmiany hasła.');
        else alert(e.message || 'Błąd podczas zmiany hasła.');
      }
    });
  })();
});
