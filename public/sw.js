const CACHE = 'aurora-gomoku-v2.1.0'
const CACHE_PREFIX = 'aurora-gomoku-'
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './rapfi-worker.js',
  './engine/rapfi.js',
  './engine/rapfi-single-simd128.wasm',
  './engine/rapfi-single-simd128.data',
]

async function cacheAppShell() {
  const cache = await caches.open(CACHE)
  await cache.addAll(APP_SHELL)

  // Vite fingerprints the production JS and CSS. Discover those exact URLs
  // from the built entry so a fresh PWA install is complete before offline use.
  const indexResponse = await cache.match('./index.html')
  if (!indexResponse) throw new Error('PWA 入口缓存失败')
  const html = await indexResponse.text()
  const scope = self.registration.scope
  const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)]
    .map((match) => new URL(match[1], scope))
    .filter((url) => url.origin === self.location.origin && url.href.startsWith(scope))
    .map((url) => url.href)
  if (assets.length) await cache.addAll([...new Set(assets)])

  // Vite emits the fallback module worker as a separate hashed asset whose
  // name is referenced from the main JS bundle rather than from index.html.
  const workerAssets = []
  for (const asset of assets.filter((url) => /\/assets\/[^/]+\.js(?:$|\?)/i.test(url))) {
    const bundle = await cache.match(asset)
    if (!bundle) continue
    const source = await bundle.text()
    for (const match of source.matchAll(/["'](ai\.worker-[A-Za-z0-9_-]+\.js)["']/g)) {
      workerAssets.push(new URL(match[1], asset).href)
    }
  }
  if (workerAssets.length) await cache.addAll([...new Set(workerAssets)])
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell())
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)),
    )),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && new URL(event.request.url).origin === location.origin) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(event.request, copy))
        }
        return response
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html'))),
  )
})
