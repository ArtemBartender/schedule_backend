// v1 — shell + runtime cache
const CORE = [
  '/', '/dashboard',
  '/static/css/style.css',
  '/static/js/app.js'
];
self.addEventListener('install', e=>{
  e.waitUntil(caches.open('core-v1').then(c=>c.addAll(CORE)));
  self.skipWaiting();
});
self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(k=>!['core-v1','rt-v1'].includes(k)).map(k=>caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e=>{
  const {request} = e;
  const url = new URL(request.url);
  // runtime cache для статики и GET API
  if (request.method==='GET' && (url.pathname.startsWith('/static/') || url.pathname.startsWith('/api/'))){
    e.respondWith(
      caches.open('rt-v1').then(async cache=>{
        try{
          const net = await fetch(request);
          if (net.ok) cache.put(request, net.clone());
          return net;
        }catch{
          const cached = await cache.match(request);
          return cached || new Response(JSON.stringify({offline:true}), {status:503, headers:{'content-type':'application/json'}});
        }
      })
    );
  }
});
