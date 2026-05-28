/* ============================================================
 * sw.js — Trading 서비스워커
 * ============================================================
 *
 * 전략 요약:
 *   1) 앱 셸 (HTML/manifest/아이콘) — network-first + 캐시 fallback
 *      → 온라인이면 항상 최신, 오프라인이면 캐시로 렌더
 *
 *   2) 정적 CDN (Firebase SDK, Chart.js, Google Fonts)
 *      → stale-while-revalidate (캐시 즉시 + 백그라운드 갱신)
 *      → 오프라인에서도 SDK가 로드돼야 앱이 뜸. 캐시 필수.
 *
 *   3) Firestore/Auth API
 *      → SW가 손대지 않음. SDK의 IndexedDB persistence가 처리.
 *
 * 배포 시:
 *   CACHE_VERSION을 올리면 새 캐시가 만들어지고 옛 캐시는 정리됨.
 * ============================================================ */

const CACHE_VERSION = 'v2';   // ← 이전 v1 캐시 강제 정리용
const APP_CACHE     = `trading-app-${CACHE_VERSION}`;
const CDN_CACHE     = `trading-cdn-${CACHE_VERSION}`;

/* 앱 셸 — install 시 precache */
const APP_SHELL = [
  '/tradingjournal/',
  '/tradingjournal/index.html',
  '/tradingjournal/manifest.json',
  '/tradingjournal/icons/icon.svg',
  '/tradingjournal/icons/icon-192.png',
  '/tradingjournal/icons/icon-512.png',
];

/* stale-while-revalidate 대상 CDN 호스트 (정확 매칭) */
const CDN_HOSTS = [
  'www.gstatic.com',          // Firebase SDK ESM
  'cdn.jsdelivr.net',         // Chart.js
  'fonts.googleapis.com',     // Google Fonts CSS
  'fonts.gstatic.com',        // Google Fonts woff2
];

/* Firestore/Auth — SW 패스 (SDK가 직접 처리) */
const FIRESTORE_HOSTS = [
  'firestore.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
];

/* ─────────────────────────────────────────────
 * install — 앱 셸 precache
 * ───────────────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE).then(cache => {
      // 개별 실패가 install 전체를 막지 않도록 allSettled
      return Promise.allSettled(
        APP_SHELL.map(url => cache.add(url).catch(err => {
          console.warn('[sw] precache skip:', url, err);
        }))
      );
    }).then(() => self.skipWaiting())
  );
});

/* ─────────────────────────────────────────────
 * activate — 옛 캐시 정리 + 즉시 클라이언트 제어
 * ───────────────────────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== APP_CACHE && k !== CDN_CACHE)
          .map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

/* ─────────────────────────────────────────────
 * fetch — 라우팅
 * ───────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const req = event.request;

  // GET 외 메서드는 캐시 우회 (Cache.put 불가)
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // http(s) 외 스킴은 무시 (chrome-extension, data, blob 등 — Cache API 거부)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 1) Firestore/Auth → SW 패스
  if (FIRESTORE_HOSTS.includes(url.hostname)) return;

  // 2) 같은 origin (앱 셸/HTML/아이콘)
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, APP_CACHE));
    return;
  }

  // 3) 정적 CDN
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req, CDN_CACHE));
    return;
  }

  // 4) 그 외 → 캐시 안 함 (브라우저 기본)
});

/* ─────────────────────────────────────────────
 * 전략 1: network-first
 *   온라인 → 최신. 오프라인 → 캐시 fallback.
 *   HTML/앱 셸용. 새 배포 즉시 반영이 중요.
 * ───────────────────────────────────────────── */
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
    // 네비게이션인데 캐시도 없으면 루트로 fallback
    if (req.mode === 'navigate') {
      const root = await caches.match('/tradingjournal/');
      if (root) return root;
    }
    throw err;
  }
}

/* ─────────────────────────────────────────────
 * 전략 2: stale-while-revalidate
 *   캐시 즉시 응답 + 백그라운드 갱신.
 *   CDN 정적 자원용. 다음 방문부터 최신.
 * ───────────────────────────────────────────── */
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
  throw new Error('sw: no cache and no network for ' + req.url);
}
