(function(){
  const modal = document.getElementById('reset-modal');
  const openBtn = document.getElementById('forgot-link');
  const closeBtn = document.getElementById('reset-close');
  const sendBtn = document.getElementById('reset-send');
  const oldPass = document.getElementById('old-pass');
  const newPass = document.getElementById('new-pass');

  // Zmieniamy tekst linka
  if (openBtn) openBtn.textContent = 'Zmień hasło';

  const api = async (url, opts) => {
    const res = await fetch(url, Object.assign({headers:{'Content-Type':'application/json'}}, opts||{}));
    const body = await res.json().catch(()=>({}));
    if (!res.ok) throw new Error(body.error || 'Błąd');
    return body;
  };

  openBtn?.addEventListener('click', e => {
    e.preventDefault();
    modal.classList.remove('hidden');
  });
  closeBtn?.addEventListener('click', ()=> modal.classList.add('hidden'));

  sendBtn?.addEventListener('click', async ()=>{
    const oldP = oldPass.value.trim();
    const newP = newPass.value.trim();
    if (!oldP || !newP) return alert('Wpisz oba pola');
    try{
      await api('/api/password/change', {
        method:'POST',
        body: JSON.stringify({ stare_haslo: oldP, nowe_haslo: newP })
      });
      alert('Hasło zostało zmienione pomyślnie.');
      modal.classList.add('hidden');
      oldPass.value = '';
      newPass.value = '';
    }catch(e){
      alert(e.message || 'Błąd podczas zmiany hasła.');
    }
  });
})();
