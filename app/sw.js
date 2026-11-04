/*
 * FDE 备考 PWA Service Worker
 * 目标：根治 iOS 主屏 WebApp 启动快照导致的版本滞后（dev-docs/design/2026-11-04-service-worker-pwa版本更新根治方案.md）
 * 策略：/ 与 /src/* network-first（在线永远最新，离线回退）；/data/*.json cache-first+后台更新（4MB 题库不重复下载）；/api/* 永不缓存。
 * 发版检查单：下方 VERSION 必须与 src/app.js 的 UI_BUILD 同步递增（tests/version.test.mjs 锁定）。
 */
const VERSION='1103i';
const UI_CACHE=`fde-ui-${VERSION}`;
const DATA_CACHE=`fde-data-${VERSION}`;

self.addEventListener('install',()=>{ self.skipWaiting(); });
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    await self.clients.claim();
    const keep=new Set([UI_CACHE,DATA_CACHE]);
    for(const name of await caches.keys()){
      if(!keep.has(name)) await caches.delete(name);
    }
  })());
});

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==location.origin) return;
  if(url.pathname.startsWith('/api/')) return; // 学习记录与 AI 接口：实时性优先，永不缓存
  if(url.pathname==='/data/'||url.pathname.startsWith('/data/')){
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }
  event.respondWith(networkFirst(event.request)); // /、/src/*、图标、manifest
});

async function networkFirst(request){
  const cache=await caches.open(UI_CACHE);
  try{
    const response=await fetch(request);
    if(response&&response.ok) cache.put(request,response.clone());
    return response;
  }catch(err){
    const hit=await cache.match(request,{ignoreSearch:true});
    if(hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(request){
  const cache=await caches.open(DATA_CACHE);
  const hit=await cache.match(request,{ignoreSearch:true});
  const fresh=fetch(request).then(response=>{
    if(response&&response.ok) cache.put(request,response.clone());
    return response;
  }).catch(()=>null);
  if(hit) return hit; // 立即返回旧数据，后台静默更新
  const response=await fresh;
  if(response) return response;
  throw new Error('offline and no cache');
}
