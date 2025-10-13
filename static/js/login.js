(function(){
  const modal = document.getElementById('reset-modal');
  const openBtn = document.getElementById('forgot-link');
  const closeBtn = document.getElementById('reset-close');
  const sendBtn = document.getElementById('reset-send');
  const emailInput = document.getElementById('reset-email');

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
    const email = emailInput.value.trim();
    if (!email) return alert('Podaj email');
    try{
      await api('/api/password/request', { method:'POST', body: JSON.stringify({email}) });
      alert('Jeśli email istnieje, wysłano link resetujący.');
      modal.classList.add('hidden');
    }catch(e){
      alert(e.message || 'Błąd');
    }
  });
})();
