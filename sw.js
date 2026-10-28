/* 필카운터 서비스 워커 — 앱 설치(홈 화면에 추가)와 오프라인 사용
   항상 인터넷의 최신 파일을 먼저 쓰고(업데이트 바로 반영), 인터넷이 안 될 때만 저장해 둔 파일을 씀 */
const CACHE='pillcounter-v1';
const CORE=['./','index.html','engine.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png'];
self.addEventListener('install',e=>{ self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).catch(()=>{})); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch',e=>{
  const r=e.request, u=new URL(r.url);
  if(r.method!=='GET'||u.origin!==location.origin) return;
  if(u.pathname.endsWith('version.json')) return;            // 업데이트 확인은 항상 인터넷에서
  e.respondWith(fetch(r).then(res=>{
    if(res.ok){ const cp=res.clone(); caches.open(CACHE).then(c=>c.put(r,cp)); }
    return res;
  }).catch(()=>caches.match(r,{ignoreSearch:true}).then(m=>m||caches.match('index.html'))));
});
