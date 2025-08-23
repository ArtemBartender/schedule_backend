// static/js/proposals.js
(function initProposals(){
  if (!document.body.classList.contains('page-proposals')) return;

  if (typeof initMenu === 'function') try { initMenu(); } catch(_) {}

  const token = getToken();
  if (!token) { window.location.href = '/'; return; }

  const listEl  = document.querySelector('#list');
  const tabBtns = Array.from(document.querySelectorAll('button[data-tab]'));
  const mgrTab  = document.querySelector('#mgr-tab');

  let data = { incoming:[], outgoing:[], for_approval:[] };
  let active = 'incoming';

  tabBtns.forEach(btn => btn.addEventListener('click', () => {
    active = btn.dataset.tab;
    tabBtns.forEach(b => b.classList.toggle('active', b === btn));
    render();
  }));

  load().catch(() => alert('Błąd pobierania propozycji'));

async function api(url, opts={}) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + getToken() }, ...opts });
  let body = null;
  try { body = await res.json(); } catch(_) { body = {}; }
  if (!res.ok) {
    const msg = body?.error || `Błąd ${res.status}`;
    throw new Error(msg);
  }
  return body;
}



  async function load(){
    const res = await fetch('/api/proposals', { headers: { Authorization: 'Bearer ' + token }});
    if (!res.ok) throw new Error('fetch /api/proposals');

    const json = await res.json();
    data.incoming      = json.incoming     || [];
    data.outgoing      = json.outgoing     || [];
    data.for_approval  = json.for_approval || json.to_approve || [];

    // вкладка менеджера видима только если есть что утверждать
    if (mgrTab) mgrTab.hidden = !(data.for_approval && data.for_approval.length);

    // по умолчанию стоим на "Odebrane"
    tabBtns.find(b=>b.dataset.tab==='incoming')?.classList.add('active');
    render();
  }

  function render(){
    listEl.innerHTML = '';
    const items = active==='incoming' ? data.incoming :
                  active==='outgoing' ? data.outgoing : data.for_approval;

    if (!items.length){
      listEl.appendChild(empty(active));
      return;
    }
    for (const sp of items) listEl.appendChild(row(sp));
  }

  // ================== ГЛУБОКИЕ ПАРСЕРЫ ==================

  const NAME_KEYS = ['full_name','fullName','name','display_name','email','mail','user'];
  const DATE_KEYS = ['date','iso','iso_date','day','shift_date','from_date','to_date','date_from','date_to','give_date','take_date','my_date','their_date'];
  const CODE_KEYS = ['shift_code','code','type','shift','give_code','take_code'];

  const DATE_RE  = /\b\d{4}-\d{2}-\d{2}\b/;         // 2025-08-21
  const DATE_RE2 = /\b\d{2}[./-]\d{2}[./-]\d{4}\b/; // 21.08.2025

  function isPlainObj(v){ return v && typeof v === 'object' && !Array.isArray(v); }

  function deepPick(obj, keys){
    if (!isPlainObj(obj)) return '';
    for (const k of keys){
      if (obj[k] != null && obj[k] !== '') return obj[k];
    }
    for (const k in obj){
      const v = obj[k];
      if (isPlainObj(v)){
        const got = deepPick(v, keys);
        if (got != null && got !== '') return got;
      }
    }
    return '';
  }

  function deepFindDate(obj, prefer=['give','from']){
    let raw = deepPick(obj, DATE_KEYS);
    if (!raw){
      let best = '';
      function walk(o, path=[]){
        if (!o) return;
        if (typeof o === 'string'){
          if (DATE_RE.test(o) || DATE_RE2.test(o)){
            const p = path.join('.').toLowerCase();
            if (!best || prefer.some(w=>p.includes(w))) best = o;
          }
          return;
        }
        if (isPlainObj(o)) for (const k in o) walk(o[k], path.concat(k));
        else if (Array.isArray(o)) o.forEach((it,i)=>walk(it, path.concat(String(i))));
      }
      walk(obj);
      raw = best;
    }
    return coerceDate(raw);
  }

  function deepFindCode(obj, prefer=['give','from']){
    let raw = deepPick(obj, CODE_KEYS);
    if (!raw){
      let best = '';
      function walk(o, path=[]){
        if (!o) return;
        if (typeof o === 'string'){
          if (/^(?:[12](?:\/B)?|B)$/.test(o.trim())){
            const p = path.join('.').toLowerCase();
            if (!best || prefer.some(w=>p.includes(w))) best = o.trim();
          }
          return;
        }
        if (isPlainObj(o)) for (const k in o) walk(o[k], path.concat(k));
        else if (Array.isArray(o)) o.forEach((it,i)=>walk(it, path.concat(String(i))));
      }
      walk(obj);
      raw = best;
    }
    return String(raw||'').trim();
  }

  function coerceName(v){
    if (v == null) return '';
    if (typeof v === 'string') return v.trim();
    if (isPlainObj(v)){
      for (const k of NAME_KEYS){
        if (typeof v[k] === 'string' && v[k].trim()) return v[k].trim();
      }
      if (v.first_name || v.last_name){
        return [v.first_name||'', v.last_name||''].join(' ').trim();
      }
    }
    return '';
  }

  function coerceDate(x){
    if (!x) return '';
    if (x instanceof Date) return fmtDate(x);
    if (typeof x === 'number') return fmtDate(new Date(x));
    if (typeof x === 'string'){
      if (/^\d{4}-\d{2}-\d{2}$/.test(x)) {
        const [y,m,d] = x.split('-').map(n=>+n);
        return fmtDate(new Date(y, m-1, d));
      }
      if (/^\d{4}-\d{2}-\d{2}T/.test(x)) return fmtDate(new Date(x));
      if (DATE_RE2.test(x)) return x.replace(/-/g,'.').replace(/\//g,'.');
    }
    if (isPlainObj(x)) return coerceDate(deepPick(x, DATE_KEYS) || JSON.stringify(x).match(DATE_RE)?.[0] || '');
    return '';
  }

  function fmtDate(dt){
    if (!(dt instanceof Date) || isNaN(dt)) return '';
    return dt.toLocaleDateString('pl-PL', { day:'2-digit', month:'2-digit', year:'numeric' });
  }

  // ================== РЕНДЕР КАРТОЧКИ ==================

  function row(sp){
    const from =
      coerceName(sp.requester) || coerceName(sp.requester_user) || coerceName(sp.requester_name) || coerceName(sp.from) || '—';
    const to =
      coerceName(sp.target_user) || coerceName(sp.target) || coerceName(sp.target_name) || coerceName(sp.to) || '—';

    // даты
    const give =
      coerceDate(sp.give_date ?? sp.from_date ?? sp.date_from ?? sp.my_date) ||
      deepFindDate({ give:sp.give, from:sp.from }) || '—';

    const take =
      coerceDate(sp.take_date ?? sp.to_date ?? sp.date_to ?? sp.their_date) ||
      deepFindDate({ take:sp.take, to:sp.to }) || '—';

    // коды смен (если пришли)
    const giveCode =
      (sp.give_code || '') ||
      deepFindCode({ give:sp.give, from:sp.from }) || '';

    const takeCode =
      (sp.take_code || '') ||
      deepFindCode({ take:sp.take, to:sp.to }) || '';

    const status = String(sp.status || '').toLowerCase();

    const card = el('div', 'card row between center');

    const left = el('div','col');
    const who  = el('div','who');
    who.innerHTML = `<strong>${esc(from)}</strong> <span class="muted">→</span> <strong>${esc(to)}</strong>`;

    const chips = el('div','chips');
    chips.appendChild(chip(give + (giveCode ? ` (${giveCode})` : ''), 'pill pill-give'));
    chips.appendChild(el('span','muted arrow','→'));
    chips.appendChild(chip(take + (takeCode ? ` (${takeCode})` : ''), 'pill pill-take'));

    left.appendChild(who);
    left.appendChild(chips);

    const right = el('div','status');
    right.appendChild(statePill(status));

    // ====== КНОПКИ ДЕЙСТВИЙ ======
    const activeTab = (document.querySelector('button[data-tab].active')?.dataset.tab) || 'incoming';

    // 1) вкладка Odebrane — акцепт/отказ получателя
    if (activeTab === 'incoming' && status === 'pending') {
      const acc = el('button','pill action','Akceptuj');
      const dec = el('button','pill action','Odrzuć');
      acc.addEventListener('click', async ()=>{ try{
        await fetch(`/api/proposals/${sp.id}/accept`, { method:'POST', headers:{Authorization:'Bearer '+getToken()} });
        await load(); toast?.success?.('Zaakceptowano'); 
      }catch(e){ alert('Błąd'); }});
      dec.addEventListener('click', async ()=>{ try{
        await fetch(`/api/proposals/${sp.id}/decline`, { method:'POST', headers:{Authorization:'Bearer '+getToken()} });
        await load(); toast?.info?.('Odrzucono');
      }catch(e){ alert('Błąd'); }});
      right.appendChild(acc);
      right.appendChild(dec);
    }

    // 2) вкладка Wysłane — отмена автором
    if (activeTab === 'outgoing' && status === 'pending') {
      const cancel = el('button','pill action','Anuluj');
      cancel.addEventListener('click', async ()=>{ try{
        await fetch(`/api/proposals/${sp.id}/cancel`, { method:'POST', headers:{Authorization:'Bearer '+getToken()} });
        await load(); toast?.info?.('Anulowano');
      }catch(e){ alert('Błąd'); }});
      right.appendChild(cancel);
    }

    // 3) вкладка Do zatwierdzenia — кнопки менеджера
    if (activeTab === 'manager' && status === 'accepted') {
      const approve = el('button','pill action','Zatwierdź');
      const reject  = el('button','pill action','Odrzuć');
      approve.addEventListener('click', async ()=>{ 
        try{
          await api(`/api/proposals/${sp.id}/approve`, { method:'POST' });
          await load(); toast?.success?.('Zatwierdzono');
        }catch(e){ alert(e.message); }
      });

      reject.addEventListener('click', async ()=>{ try{
        await fetch(`/api/proposals/${sp.id}/reject`, { method:'POST', headers:{Authorization:'Bearer '+getToken()} });
        await load(); toast?.info?.('Odrzucono');
      }catch(e){ alert('Błąd'); }});
      right.appendChild(approve);
      right.appendChild(reject);
    }

    card.appendChild(left);
    card.appendChild(right);
    return card;
  }

  // ================== UI утилиты ==================

  function statePill(s){
    const map = {
      pending:   ['W oczekiwaniu', 'pill-warn'],
      accepted:  ['Zaakceptowano', 'pill-ok'],
      declined:  ['Odrzucono', 'pill-bad'],
      rejected:  ['Odrzucono', 'pill-bad'],
      approved:  ['Zatwierdzono', 'pill-ok'],
      canceled:  ['Anulowano', 'pill-muted'],
      cancelled: ['Anulowano', 'pill-muted'],
    };
    const [txt, cls] = map[s] || ['—','pill-muted'];
    return el('span', `pill ${cls}`, txt);
  }

  function chip(text, cls){ return el('span', cls || 'pill', text || '—'); }

  function empty(kind){
    const map = {
      incoming: 'Brak propozycji',
      outgoing: 'Brak propozycji',
      manager:  'Brak propozycji do zatwierdzenia'
    };
    return el('div','empty muted', map[kind] || 'Brak danych');
  }

  function el(tag, cls, text){
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function esc(s){ return String(s||'').replace(/[&<>"]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m])); }
})();
