/* ============================================================
 * sw-finance.js — Finance 서비스워커
 * ============================================================
 * 전략: sw.js와 동일.
 *   - 앱 셸: network-first
 *   - CDN: stale-while-revalidate
 *   - Firestore: SW 패스 (SDK가 IndexedDB로 처리)
 * 캐시 이름은 Trading 앱과 분리.
 * ============================================================ */

const CACHE_VERSION = 'v3';   // ← v0.8-1 가져오기 기능 배포 (이전 캐시 강제 정리)
const APP_CACHE     = `finance-app-${CACHE_VERSION}`;
const CDN_CACHE     = `finance-cdn-${CACHE_VERSION}`;

const APP_SHELL = [
  '/tradingjournal/finance.html',
  '/tradingjournal/manifest-finance.json',
  '/tradingjournal/icons/icon-finance-192.png',
  '/tradingjournal/icons/icon-finance-512.png',
];

const CDN_HOSTS = [
  'www.gstatic.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

const FIRESTORE_HOSTS = [
  'firestore.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE).then(cache => {
      return Promise.allSettled(
        APP_SHELL.map(url => cache.add(url).catch(err => {
          console.warn('[sw-finance] precache skip:', url, err);
        }))
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== APP_CACHE && k !== CDN_CACHE)
          .map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // http(s) 외 스킴 무시
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (FIRESTORE_HOSTS.includes(url.hostname)) return;

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, APP_CACHE));
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req, CDN_CACHE));
    return;
  }
});

async function networkFirst(req, cacheName) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const root = await caches.match('/tradingjournal/finance.html');
      if (root) return root;
    }
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);

  const network = fetch(req).then(res => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);

  if (cached) return cached;
  const res = await network;
  if (res) return res;
  throw new Error('sw-finance: no cache and no network for ' + req.url);
}
