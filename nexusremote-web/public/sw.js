const CACHE='nexusremote-spatial-v2-20261106';
const STATIC=new Set(['/styles.css','/experience.css','/site.js','/experience.js','/portal-extras.js','/nexus-icon.svg']);
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['/offline.html',...STATIC])).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('nexusremote-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin)return;
 if(url.pathname.startsWith('/api/')||['/login','/portal','/apply','/privacy','/login.html','/portal.html','/apply.html','/privacy.html'].includes(url.pathname))return;
 if(req.mode==='navigate'){
  event.respondWith(fetch(req).catch(()=>caches.match('/offline.html')));return;
 }
 if(STATIC.has(url.pathname)){
  event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(response=>{
   if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(req,copy))}
   return response;
  })));
 }
});
