// 오프라인에서도 연습할 수 있게 화면 파일을 기기에 저장합니다.
// 백업 서버(/api/)는 저장하지 않습니다. 화면 파일을 고치면 VERSION을 올려 주세요.
const VERSION = 'v3.4.1';
const CACHE = `malhagi-${VERSION}`;
const FILES = [
  './',
  './index.html',
  './privacy.html',
  './manifest.webmanifest',
  './css/app.css',
  './fonts/fonts.css',
  './fonts/Pretendard-Regular.core.woff2',
  './fonts/Pretendard-SemiBold.core.woff2', // 드문 글자용 *.hangul.woff2는 필요할 때 받아 저장
  './js/app.js',
  './js/backup.js',
  './js/speech.js',
  './js/store.js',
  './js/ui.js',
  './js/words.js',
  './icons/logo.svg',
  './icons/icon-192.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('malhagi-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(e.request);
      if (res.ok && (url.pathname.includes('/fonts/') || url.pathname.includes('/icons/'))) cache.put(e.request, res.clone());
      return res;
    } catch {
      if (e.request.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
