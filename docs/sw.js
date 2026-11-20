// 서비스 워커: 앱 화면 파일만 저장해 오프라인에서도 열리게 합니다.
// GAS 요청(다른 도메인)은 건드리지 않습니다. 배포할 때마다 VERSION을 올려 주세요.
const VERSION = 'v2.1.0';
const CACHE = `malhagi-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './privacy.html',
  './manifest.webmanifest',
  './css/app.css',
  './vendor/qrcode.js',
  './fonts/fonts.css',
  './fonts/Pretendard-Regular.core.woff2',
  './fonts/Pretendard-SemiBold.core.woff2', // 드문 글자용 *.hangul.woff2는 필요할 때 받아 저장
  './js/font-size.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './js/app.js', './js/api.js', './js/config.js', './js/crypto.js', './js/curriculum.js',
  './js/speech.js', './js/store.js', './js/sync.js', './js/ui.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('malhagi-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // 네트워크 우선, 실패하면 저장본 (업데이트가 바로 반영되도록)
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});
