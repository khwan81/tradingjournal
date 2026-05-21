const CACHE_NAME = 'finance-v1';

// 오프라인에서도 앱 껍데기는 보여주기 위한 캐시 목록
const SHELL_ASSETS = [
  '/tradingjournal/finance.html',
  '/tradingjournal/manifest-finance.json',
];

// 설치 시 shell 캐시
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// 활성화 시 이전 캐시 정리
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// 네트워크 우선, 실패 시 캐시 (Firebase는 항상 네트워크)
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Firebase / CDN 요청은 캐시하지 않음 (항상 최신 데이터)
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('google') ||
    url.hostname.includes('cdnjs') ||
    url.hostname.includes('fonts')
  ) {
    return; // 브라우저 기본 동작
  }

  // 앱 shell: 네트워크 우선, 실패 시 캐시
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
