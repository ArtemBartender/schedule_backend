// static/js/proposals.js (без async/await)
(function () {
  if (!document.body.classList.contains('page-proposals')) return;
  if (typeof initMenu === 'function') { try { initMenu(); } catch (_) {} }

  var listEl  = document.querySelector('#list');
  var tabBtns = Array.prototype.slice.call(document.querySelectorAll('button[data-tab]'));
  var mgrTab  = document.querySelector('#mgr-tab');

  var data   = { incoming: [], outgoing: [], for_approval: [] };
  var active = 'incoming';
  var redirected = false;

  // ----- utils
  function getCookie(name) {
    var items = document.cookie ? document.cookie.split('; ') : [];
    for (var i=0;i<items.length;i++){
      var it = items[i];
      var idx = it.indexOf('=');
      var key = idx > -1 ? decodeURIComponent(it.slice(0, idx)) : decodeURIComponent(it);
      if (key === name) return idx > -1 ? decodeURIComponent(it.slice(idx + 1)) : '';
    }
    return '';
  }

  function handleAuth401(){
    if (redirected) throw new Error('Unauthorized');
    redirected = true;
    var q = new URLSearchParams({ redirect: '/proposals' }).toString();
    fetch('/start', { method:'HEAD' })
      .then(function(r){ window.location.href = (r.ok?'/start?':'/?') + q; })
      .catch(function(){ window.location.href='/?'+q; });
    return new Promise(function(){}); // break chain
  }

  // ЗАМЕНИ ЭТУ ФУНКЦИЮ В proposals.js ЦЕЛИКОМ
  function apiCall(url, opts) {
    opts = opts || {};

    // 1) Если в проекте есть общий клиент — используем его (он сам подставит токен/refresh/CSRF)
    if (typeof window.api === 'function') {
      return window.api(url, opts).catch(function (err) {
        // Не редиректим — просто пробрасываем ошибку наверх, чтобы видеть её в alert/Network
        throw err || new Error('Request failed');
      });
    }

    // 2) Фолбэк без редиректов: отправляем куки и, для не-GET, X-CSRF из cookie
    var headers = Object.assign({}, opts.headers || {});
    var method  = (opts.method || 'GET').toUpperCase();

    if (method !== 'GET' && !headers['X-CSRF-TOKEN']) {
      var csrf = (function getCookie(name){
        var items = document.cookie ? document.cookie.split('; ') : [];
        for (var i=0;i<items.length;i++){
          var it = items[i], idx = it.indexOf('=');
          var key = idx>-1 ? decodeURIComponent(it.slice(0,idx)) : decodeURIComponent(it);
          if (key === name) return idx>-1 ? decodeURIComponent(it.slice(idx+1)) : '';
        }
        return '';
      })('csrf_access_token');
      if (csrf) headers['X-CSRF-TOKEN'] = csrf;
    }

    return fetch(url, Object.assign({}, opts, {
      headers: headers,
      credentials: 'include',
      cache: 'no-store'
    }))
    .then(function (res) {
      var ct = res.headers.get('content-type') || '';
      var parse = ct.indexOf('application/json') !== -1 ? res.json() : res.text();
      return parse.catch(function(){ return {}; }).then(function(body){
        if (!res.ok) {
          var err = new Error((body && (body.error || body.msg)) || ('HTTP '+res.status));
          err.status = res.status;
          throw err;
        }
        return body;
      });
    });
  }


  // ----- tabs
  tabBtns.forEach(function(btn){
    btn.addEventListener('click', function(){
      active = btn.dataset.tab;
      tabBtns.forEach(function(b){ b.classList.toggle('active', b === btn); });
      render();
    });
  });

  // ----- init
  load().catch(function(e){ if(!redirected) alert((e && e.message) || 'Błąd pobierania propozycji'); });

  function load(){
    return apiCall('/api/proposals').then(function(json){
      data.incoming     = json.incoming     || [];
      data.outgoing     = json.outgoing     || [];
      data.for_approval = json.for_approval || json.to_approve || [];
      if (mgrTab) mgrTab.hidden = !data.for_approval.length;
      var def = tabBtns.find(function(b){ return b.dataset.tab === 'incoming'; });
      if (def) def.classList.add('active');
      var actBtn = tabBtns.find(function(b){ return b.classList.contains('active'); });
      active = (actBtn && actBtn.dataset.tab) || 'incoming';
      render();
    });
  }

  function render(){
    if (!listEl) return;
    listEl.innerHTML = '';
    var items = active === 'incoming' ? data.incoming :
                active === 'outgoing' ? data.outgoing :
                data.for_approval;
    if (!items.length){
      listEl.appendChild(empty(active));
      return;
    }
    items.forEach(function(sp){ listEl.appendChild(row(sp)); });
  }

  // ===== parsing helpers
  var NAME_KEYS = ['full_name','fullName','name','display_name','email','mail','user'];
  var DATE_KEYS = ['date','iso','iso_date','day','shift_date','from_date','to_date','date_from','date_to','give_date','take_date','my_date','their_date'];
  var CODE_KEYS = ['shift_code','code','type','shift','give_code','take_code'];
  var DATE_RE  = /\b\d{4}-\d{2}-\d{2}\b/;
  var DATE_RE2 = /\b\d{2}[./-]\d{2}[./-]\d{4}\b/;

  function isPlainObj(v){ return v && typeof v === 'object' && !Array.isArray(v); }
  function deepPick(obj, keys){
    if (!isPlainObj(obj)) return '';
    for (var i=0;i<keys.length;i++){ var k = keys[i]; if (obj[k]!=null && obj[k] !== '') return obj[k]; }
    for (var kk in obj){
      var v = obj[kk];
      if (isPlainObj(v)){
        var got = deepPick(v, keys);
        if (got != null && got !== '') return got;
      }
    }
    return '';
  }
  function deepFindDate(obj, prefer){
    prefer = prefer || ['give','from'];
    var raw = deepPick(obj, DATE_KEYS);
    if (!raw){
      var best = '';
      (function walk(o, path){
        path = path || [];
        if (!o) return;
        if (typeof o === 'string'){
          if (DATE_RE.test(o) || DATE_RE2.test(o)){
            var p = path.join('.').toLowerCase();
            if (!best || prefer.some(function(w){ return p.indexOf(w) !== -1; })) best = o;
          }
          return;
        }
        if (isPlainObj(o)) for (var k in o) walk(o[k], path.concat(k));
        else if (Array.isArray(o)) o.forEach(function(it,i){ walk(it, path.concat(String(i))); });
      })(obj);
      raw = best;
    }
    return coerceDate(raw);
  }
  function deepFindCode(obj, prefer){
    prefer = prefer || ['give','from'];
    var raw = deepPick(obj, CODE_KEYS);
    if (!raw){
      var best = '';
      (function walk(o, path){
        path = path || [];
        if (!o) return;
        if (typeof o === 'string'){
          if (/^(?:[12](?:\/B)?|B)$/.test(o.trim())){
            var p = path.join('.').toLowerCase();
            if (!best || prefer.some(function(w){ return p.indexOf(w)!==-1; })) best = o.trim();
          }
          return;
        }
        if (isPlainObj(o)) for (var k in o) walk(o[k], path.concat(k));
        else if (Array.isArray(o)) o.forEach(function(it,i){ walk(it, path.concat(String(i))); });
      })(obj);
      raw = best;
    }
    return String(raw||'').trim();
  }
  function coerceName(v){
    if (v == null) return '';
    if (typeof v === 'string') return v.trim();
    if (isPlainObj(v)){
      for (var i=0;i<NAME_KEYS.length;i++){
        var k = NAME_KEYS[i];
        if (typeof v[k] === 'string' && v[k].trim()) return v[k].trim();
      }
      if (v.first_name || v.last_name) return (v.first_name||'') + ' ' + (v.last_name||'').trim();
    }
    return '';
  }
  function coerceDate(x){
    if (!x) return '';
    if (Object.prototype.toString.call(x) === '[object Date]') return fmtDate(x);
    if (typeof x === 'number') return fmtDate(new Date(x));
    if (typeof x === 'string'){
      if (/^\d{4}-\d{2}-\d{2}$/.test(x)){
        var a = x.split('-'); return fmtDate(new Date(+a[0], +a[1]-1, +a[2]));
      }
      if (/^\d{4}-\d{2}-\d{2}T/.test(x)) return fmtDate(new Date(x));
      if (DATE_RE2.test(x)) return x.replace(/-/g,'.').replace(/\//g,'.');
    }
    if (isPlainObj(x)) return coerceDate(deepPick(x, DATE_KEYS) || (JSON.stringify(x).match(DATE_RE)||[''])[0] || '');
    return '';
  }
  function fmtDate(dt){
    if (!(dt instanceof Date) || isNaN(dt)) return '';
    return dt.toLocaleDateString('pl-PL', { day:'2-digit', month:'2-digit', year:'numeric' });
  }

  // ===== render row
  function row(sp){
    var from = coerceName(sp.requester) || coerceName(sp.requester_user) || coerceName(sp.requester_name) || coerceName(sp.from) || '—';
    var to   = coerceName(sp.target_user) || coerceName(sp.target) || coerceName(sp.target_name) || coerceName(sp.to) || '—';

    var give = coerceDate(sp.give_date || sp.from_date || sp.date_from || sp.my_date) || deepFindDate({ give:sp.give, from:sp.from }) || '—';
    var take = coerceDate(sp.take_date || sp.to_date || sp.date_to || sp.their_date) || deepFindDate({ take:sp.take, to:sp.to }) || '—';

    var giveCode = (sp.give_code || '') || deepFindCode({ give:sp.give, from:sp.from }) || '';
    var takeCode = (sp.take_code || '') || deepFindCode({ take:sp.take, to:sp.to }) || '';

    var status = String(sp.status || '').toLowerCase();

    var card = el('div', 'card row between center');
    var left = el('div','col');
    var who  = el('div','who');
    who.innerHTML = '<strong>'+esc(from)+'</strong> <span class="muted">→</span> <strong>'+esc(to)+'</strong>';

    var chips = el('div','chips');
    chips.appendChild(chip(give + (giveCode ? ' ('+giveCode+')' : ''), 'pill pill-give'));
    chips.appendChild(el('span','muted arrow','→'));
    chips.appendChild(chip(take + (takeCode ? ' ('+takeCode+')' : ''), 'pill pill-take'));

    left.appendChild(who);
    left.appendChild(chips);

    var right = el('div','status');
    right.appendChild(statePill(status));

    var activeTabBtn = document.querySelector('button[data-tab].active');
    var activeTab = (activeTabBtn && activeTabBtn.dataset.tab) || 'incoming';

    // Odebrane — accept/decline
    if (activeTab === 'incoming' && status === 'pending') {
      var acc = el('button','pill action accept','Akceptuj');
      var dec = el('button','pill action decline','Odrzuć');
      acc.addEventListener('click', function(){
        apiCall('/api/proposals/'+sp.id+'/accept', { method:'POST' })
          .then(function(){ return load(); })
          .then(function(){ window.toast && window.toast.success && window.toast.success('Zaakceptowano'); })
          .catch(function(e){ if(!redirected) alert(e.message || 'Błąd'); });
      });
      dec.addEventListener('click', function(){
        apiCall('/api/proposals/'+sp.id+'/decline', { method:'POST' })
          .then(function(){ return load(); })
          .then(function(){ window.toast && window.toast.info && window.toast.info('Odrzucono'); })
          .catch(function(e){ if(!redirected) alert(e.message || 'Błąd'); });
      });
      right.appendChild(acc);
      right.appendChild(dec);
    }

    // Wysłane — cancel
    if (activeTab === 'outgoing' && status === 'pending') {
      var cancel = el('button','pill action cancel','Anuluj');
      cancel.addEventListener('click', function(){
        apiCall('/api/proposals/'+sp.id+'/cancel', { method:'POST' })
          .then(function(){ return load(); })
          .then(function(){ window.toast && window.toast.info && window.toast.info('Anulowano'); })
          .catch(function(e){ if(!redirected) alert(e.message || 'Błąd'); });
      });
      right.appendChild(cancel);
    }

    // Do zatwierdzenia — approve/reject
    if (activeTab === 'manager' && status === 'accepted') {
      var approve = el('button','pill action accept','Zatwierdź');
      var reject  = el('button','pill action decline','Odrzuć');
      approve.addEventListener('click', function(){
        apiCall('/api/proposals/'+sp.id+'/approve', { method:'POST' })
          .then(function(){ return load(); })
          .then(function(){ window.toast && window.toast.success && window.toast.success('Zatwierdzono'); })
          .catch(function(e){ if(!redirected) alert(e.message || 'Błąd'); });
      });
      reject.addEventListener('click', function(){
        apiCall('/api/proposals/'+sp.id+'/reject', { method:'POST' })
          .then(function(){ return load(); })
          .then(function(){ window.toast && window.toast.info && window.toast.info('Odrzucono'); })
          .catch(function(e){ if(!redirected) alert(e.message || 'Błąd'); });
      });
      right.appendChild(approve);
      right.appendChild(reject);
    }

    card.appendChild(left);
    card.appendChild(right);
    return card;
  }

  // ===== UI helpers
  function statePill(s){
    var map = {
      pending:   ['W oczekiwaniu', 'pill-warn'],
      accepted:  ['Zaakceptowano', 'pill-ok'],
      declined:  ['Odrzucono', 'pill-bad'],
      rejected:  ['Odrzucono', 'pill-bad'],
      approved:  ['Zatwierdzono', 'pill-ok'],
      canceled:  ['Anulowano', 'pill-muted'],
      cancelled: ['Anulowano', 'pill-muted'],
    };
    var v = map[s] || ['—','pill-muted'];
    return el('span', 'pill ' + v[1], v[0]);
  }
  function chip(text, cls){ return el('span', cls || 'pill', text || '—'); }
  function empty(kind){
    var map = {
      incoming: 'Brak propozycji',
      outgoing: 'Brak propozycji',
      manager:  'Brak propozycji do zatwierdzenia'
    };
    return el('div','empty muted', map[kind] || 'Brak danych');
  }
  function el(tag, cls, text){
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function esc(s){ return String(s||'').replace(/[&<>"]/g, function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]); }); }

})();
